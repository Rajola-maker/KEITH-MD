
const { DataTypes } = require('sequelize');
const { database } = require('../settings'); 

const SettingsDB = database.define('settings', {
    prefix: {
        type: DataTypes.STRING,
        defaultValue: "#",
        allowNull: false
    },
    author: {
        type: DataTypes.STRING,
        defaultValue: "Rajola",
        allowNull: false
    },
    url: {
        type: DataTypes.STRING,
        defaultValue: "Auraen.jpg",
        allowNull: false
    },
    gurl: {
        type: DataTypes.STRING,
        defaultValue: "https://github.com/Keithkeizzah/KEITH-MD",
        allowNull: false
    },
    timezone: {
        type: DataTypes.STRING,
        defaultValue: "Africa/Tanzania",
        allowNull: false
    },
    botname: {
        type: DataTypes.STRING,
        defaultValue: "AURAEN",
        allowNull: false
    },
    packname: {
        type: DataTypes.STRING,
        defaultValue: "AURAEN",
        allowNull: false
    },
    mode: {
        type: DataTypes.STRING,
        defaultValue: "public",
        allowNull: false
    
    
    },
    sessionName: {
        type: DataTypes.STRING,
        defaultValue: "Auraen",
        allowNull: false
    }
}, {
    timestamps: true,
    tableName: 'bot_settings'
});

async function initSettingsDB() {
    try {
        await SettingsDB.sync({ alter: true });
        console.log('Settings table ready');
    } catch (error) {
        console.error('Error initializing Settings table:', error);
        throw error;
    }
}

async function getSettings() {
    try {
        let settings = await SettingsDB.findOne();
        if (!settings) {
            settings = await SettingsDB.create({});
        }
        return settings;
    } catch (error) {
        console.error('Error getting settings:', error);
        // Fallback to default settings
        return {
            prefix: "#",
            author: "Rajola⁸",
            url: "auraen.jpg",
            gurl: "https://github.com/Keithkeizzah/KEITH-MD",
            timezone: "Africa/Tanzania",
            botname: "AURAEN",
            packname: "AURAEN",
            mode: "public",
           
            sessionName: "AURAEN"
        };
    }
}

async function updateSettings(updates) {
    try {
        const settings = await getSettings();
        return await settings.update(updates);
    } catch (error) {
        console.error('Error updating settings:', error);
        return null;
    }
}

async function getSetting(key) {
    try {
        const settings = await getSettings();
        return settings[key];
    } catch (error) {
        console.error(`Error getting setting ${key}:`, error);
        return null;
    }
}

module.exports = {
    initSettingsDB,
    getSettings,
    updateSettings,
    getSetting,
    SettingsDB
};
