const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    PermissionsBitField,
} = require("discord.js");
const axios = require("axios");
const fs = require("fs").promises;
const express = require("express");

class VanityMonitorBot {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
        });

        this.monitoredVanities = new Map(); // Key: `${guildId}_${vanityUrl}`, Value: monitoring data
        this.dataFile = "./vanity_data.json";
        this.checkInterval = 30000;

        this.setupEventHandlers();
        this.loadData();
    }

    setupEventHandlers() {
        this.client.once("ready", () => {
            console.log(`${this.client.user.tag} is online!`);
            this.sendCreditsMessage();
            this.startMonitoring();
        });

        this.client.on("guildCreate", async (guild) => {
            console.log(`Bot added to new server: ${guild.name}`);
            this.sendCreditsMessageToGuild(guild);
        });

        this.client.on("messageCreate", async (message) => {
            if (message.author.bot) return;

            const args = message.content.slice(1).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            if (message.content.startsWith(",add")) {
                await this.handleAddCommand(message, args);
            } else if (message.content.startsWith(",remove")) {
                await this.handleRemoveCommand(message, args);
            } else if (message.content.startsWith(",list")) {
                await this.handleListCommand(message);
            } else if (message.content.startsWith(",help")) {
                await this.handleHelpCommand(message);
            }
        });
    }

    async sendCreditsMessage() {
        // Send credits message to all guilds when bot comes online
        for (const guild of this.client.guilds.cache.values()) {
            await this.sendCreditsMessageToGuild(guild);
        }
    }

    async sendCreditsMessageToGuild(guild) {
        try {
            // Find the first text channel the bot can send messages to
            const channel = guild.channels.cache.find(
                channel => 
                    channel.type === 0 && // Text channel
                    channel.permissionsFor(guild.members.me).has(PermissionsBitField.Flags.SendMessages)
            );

            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor("#7289da")
                    .setTitle("🤖 Vanity Monitor Bot")
                    .setDescription("This bot was made by oxy @bored_vampire on discord and @adose on telegram")
                    .addFields(
                        {
                            name: "Get Started",
                            value: "Use `,help` to see all available commands",
                            inline: false,
                        }
                    )
                    .setTimestamp();

                await channel.send({ embeds: [embed] });
                console.log(`Sent credits message to ${guild.name}`);
            }
        } catch (error) {
            console.error(`Failed to send credits message to ${guild.name}:`, error.message);
        }
    }

    async handleAddCommand(message, args) {
        if (args.length < 2 || args[0] !== "vanity") {
            return message.reply(
                "Usage: `,add vanity <vanity_url>`\nExample: `,add vanity discord-developers`",
            );
        }

        const vanityUrl = args[1].toLowerCase().replace(/[^a-z0-9-]/g, "");

        if (!vanityUrl || vanityUrl.length < 2) {
            return message.reply(
                "Please provide a valid vanity URL (letters, numbers, and hyphens only).",
            );
        }

        const guildId = message.guild?.id || "dm";
        const vanityKey = `${guildId}_${vanityUrl}`;
        
        const existingEntry = this.monitoredVanities.get(vanityKey);
        if (existingEntry && existingEntry.userId === message.author.id) {
            return message.reply(
                `You are already monitoring the vanity: **${vanityUrl}**`,
            );
        }

        const vanityExists = await this.checkVanityExists(vanityUrl);
        if (!vanityExists) {
            return message.reply(
                `The vanity **${vanityUrl}** is currently available! You can claim it now.`,
            );
        }

        this.monitoredVanities.set(vanityKey, {
            userId: message.author.id,
            channelId: message.channel.id,
            guildId: guildId,
            vanityUrl: vanityUrl,
            addedAt: Date.now(),
        });

        await this.saveData();

        const embed = new EmbedBuilder()
            .setColor("#00ff00")
            .setTitle("✅ Vanity Added to Monitor")
            .setDescription(`Now monitoring **${vanityUrl}** for availability`)
            .addFields(
                {
                    name: "Vanity URL",
                    value: `discord.gg/${vanityUrl}`,
                    inline: true,
                },
                { name: "Status", value: "Currently taken", inline: true },
            )
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }

    async handleRemoveCommand(message, args) {
        if (args.length < 2 || args[0] !== "vanity") {
            return message.reply("Usage: `,remove vanity <vanity_url>`");
        }

        const vanityUrl = args[1].toLowerCase().replace(/[^a-z0-9-]/g, "");
        const guildId = message.guild?.id || "dm";
        const vanityKey = `${guildId}_${vanityUrl}`;
        
        const entry = this.monitoredVanities.get(vanityKey);

        if (!entry || entry.userId !== message.author.id) {
            return message.reply(
                `You are not monitoring the vanity: **${vanityUrl}**`,
            );
        }

        this.monitoredVanities.delete(vanityKey);
        await this.saveData();

        const embed = new EmbedBuilder()
            .setColor("#ff0000")
            .setTitle("❌ Vanity Removed from Monitor")
            .setDescription(`Stopped monitoring **${vanityUrl}**`)
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }

    async handleListCommand(message) {
        const guildId = message.guild?.id || "dm";
        
        const userVanities = Array.from(
            this.monitoredVanities.entries(),
        ).filter(([key, data]) => {
            const [keyGuildId] = key.split('_');
            return keyGuildId === guildId && data.userId === message.author.id;
        });

        if (userVanities.length === 0) {
            return message.reply(
                "You are not monitoring any vanities in this server. Use `,add vanity <vanity_url>` to start monitoring.",
            );
        }

        const embed = new EmbedBuilder()
            .setColor("#0099ff")
            .setTitle("📋 Your Monitored Vanities")
            .setDescription(
                userVanities
                    .map(([key, data]) => `• discord.gg/${data.vanityUrl}`)
                    .join("\n"),
            )
            .setFooter({
                text: `Total: ${userVanities.length} vanit${userVanities.length === 1 ? "y" : "ies"} in this server`,
            })
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }

    async handleHelpCommand(message) {
        const embed = new EmbedBuilder()
            .setColor("#7289da")
            .setTitle("🤖 Vanity Monitor Bot - Help")
            .setDescription(
                "Monitor Discord server vanities and get notified when they become available!\n\n**This bot was made by oxy @bored_vampire on discord and @adose on telegram**",
            )
            .addFields(
                {
                    name: "`,add vanity <vanity_url>`",
                    value: "Add a vanity to monitor\nExample: `,add vanity cool-server`",
                    inline: false,
                },
                {
                    name: "`,remove vanity <vanity_url>`",
                    value: "Remove a vanity from monitoring\nExample: `,remove vanity cool-server`",
                    inline: false,
                },
                {
                    name: "`,list`",
                    value: "List all vanities you are monitoring in this server",
                    inline: false,
                },
                {
                    name: "`,help`",
                    value: "Show this help message",
                    inline: false,
                },
            )
            .setFooter({ text: "Checks every 30 seconds for availability • Each server has its own vanity list" })
            .setTimestamp();

        message.reply({ embeds: [embed] });
    }

    async checkVanityExists(vanityUrl) {
        try {
            const response = await axios.get(
                `https://discord.com/api/v10/invites/${vanityUrl}`,
                {
                    timeout: 5000,
                },
            );
            return response.status === 200;
        } catch (error) {
            if (
                error.response?.status === 404 ||
                error.response?.data?.code === 10006
            ) {
                return false;
            }

            console.log(`Error checking vanity ${vanityUrl}:`, error.message);
            return true;
        }
    }

    startMonitoring() {
        console.log("Starting vanity monitoring...");

        setInterval(async () => {
            for (const [vanityKey, data] of this.monitoredVanities.entries()) {
                try {
                    const exists = await this.checkVanityExists(data.vanityUrl);

                    if (!exists) {
                        await this.notifyVanityAvailable(data.vanityUrl, data);
                        this.monitoredVanities.delete(vanityKey);
                        await this.saveData();
                    }
                } catch (error) {
                    console.error(
                        `Error monitoring vanity ${data.vanityUrl}:`,
                        error.message,
                    );
                }
            }
        }, this.checkInterval);
    }

    async notifyVanityAvailable(vanityUrl, data) {
        try {
            const channel = await this.client.channels.fetch(data.channelId);
            const user = await this.client.users.fetch(data.userId);

            const embed = new EmbedBuilder()
                .setColor("#00ff00")
                .setTitle("🎉 Vanity Available!")
                .setDescription(
                    `The vanity **${vanityUrl}** is now available to claim!`,
                )
                .addFields(
                    {
                        name: "Vanity URL",
                        value: `discord.gg/${vanityUrl}`,
                        inline: true,
                    },
                    {
                        name: "Claim it at",
                        value: "Server Settings > Overview > Vanity URL",
                        inline: true,
                    },
                )
                .setFooter({
                    text: "Act fast - vanities can be claimed by anyone!",
                })
                .setTimestamp();

            await channel.send({
                content: `<@${data.userId}>`,
                embeds: [embed],
            });

            console.log(
                `Notified ${user.tag} that vanity ${vanityUrl} is available`,
            );
        } catch (error) {
            console.error(
                `Failed to notify about vanity ${vanityUrl}:`,
                error.message,
            );
        }
    }

    async loadData() {
        try {
            const data = await fs.readFile(this.dataFile, "utf8");
            const parsed = JSON.parse(data);
            
            // Check if data needs migration from old format
            const entries = Object.entries(parsed);
            let needsMigration = false;
            
            for (const [key, value] of entries) {
                // Old format: key is just vanityUrl, new format: key is guildId_vanityUrl
                if (!key.includes('_') || !value.vanityUrl) {
                    needsMigration = true;
                    break;
                }
            }
            
            if (needsMigration) {
                console.log("Migrating data from old format to new server-specific format...");
                const migratedData = new Map();
                
                for (const [oldKey, value] of entries) {
                    // If it's old format (key is just vanityUrl)
                    if (!oldKey.includes('_')) {
                        const guildId = value.guildId || 'dm';
                        const vanityUrl = oldKey;
                        const newKey = `${guildId}_${vanityUrl}`;
                        
                        migratedData.set(newKey, {
                            ...value,
                            vanityUrl: vanityUrl
                        });
                    } else {
                        // Already new format
                        migratedData.set(oldKey, value);
                    }
                }
                
                this.monitoredVanities = migratedData;
                await this.saveData(); // Save migrated data
                console.log(`Migrated and loaded ${this.monitoredVanities.size} monitored vanities`);
            } else {
                // Data is already in new format
                this.monitoredVanities = new Map(entries);
                console.log(`Loaded ${this.monitoredVanities.size} monitored vanities`);
            }
        } catch (error) {
            console.log("No existing data file found, starting fresh");
        }
    }

    async saveData() {
        try {
            const dataObj = Object.fromEntries(this.monitoredVanities);
            await fs.writeFile(this.dataFile, JSON.stringify(dataObj, null, 2));
        } catch (error) {
            console.error("Failed to save data:", error.message);
        }
    }

    start(token) {
        this.client.login(token);
    }
}

const bot = new VanityMonitorBot();

const BOT_TOKEN =
    process.env.BOT_TOKEN ||
    "MTM3ODc4ODIyMjIxMzI5NjE3OQ.GiOUY0.rcYaMmeRc8Nf0GFV0M02e1Yl5W5YIXnCYnXFOc";

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.json({
        status: "online",
        uptime: process.uptime(),
        monitored_vanities: bot.monitoredVanities.size,
    });
});

app.listen(port, () => {
    console.log(`Keep-alive server running on port ${port}`);
});

bot.start(BOT_TOKEN);

process.on("SIGINT", async () => {
    console.log("Shutting down...");
    await bot.saveData();
    process.exit(0);
});

process.on("unhandledRejection", (error) => {
    console.error("Unhandled promise rejection:", error);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    process.exit(1);
});
