const fs = require('fs');
const Discord = require('discord.js');
const client = new Discord.Client();

const prices = require('./prices.js');

const config = require('../config.json');

let muted = {};

try {
    muted = JSON.parse(fs.readFileSync('muted.json'));
} catch (err) {
    console.error('Failed to read muted data:');
    console.error(err);
}

let mutedWriting = false;
let mutedWriteScheduled = false;

function saveMuted() {
    if (mutedWriting) {
        mutedWriteScheduled = true;
        return;
    }
    mutedWriting = true;
    const mutedJson = {};
    for (let key of Object.keys(muted)) {
        mutedJson[key] = {
            endsAt: muted[key].endsAt
        };
    }
    fs.writeFile('muted.json', JSON.stringify(mutedJson), () => {
        if (mutedWriteScheduled) {
            mutedWriteScheduled = false;
            saveMuted();
        } else {
            mutedWriting = false;
        }
    });
}
saveMuted();

function modifyRole(role, users, addRole) {
    let promises = [];
    for (let member of users) {
        if (!config.testing) {
            // don't mute mods or bots
            if (member.user.id === client.user.id) {
                return;
            }
            if (member.roles.some(r => config.modRoles.includes(r.name))) {
                continue;
            }
        }
        let promise;
        if (addRole) {
            promise = member.addRole(role);
        } else {
            promise = member.removeRole(role);
        }
        promises.push(promise
            .then(() => [member, false])
            .catch(err => {
                console.error(err);
                return [member, true];
            }));
    }
    return Promise.all(promises).then(arr => ({
        successful: arr.filter(x => !x[1]).map(x => x[0]),
        errored: arr.filter(x => x[1]).map(x => x[0])
    }));
}

const priceBackoff = {};
client.on('message', async msg => {
    try {
        let isMod = msg.guild && msg.guild.available && msg.member &&
            msg.member.roles.some(r => config.modRoles.includes(r.name));
        const parts = msg.content.split(' ');
        if (parts[0] === '!price') {
            if (msg.channel.guild) {
                if (msg.channel.name !== 'general') {
                    return;
                }
            }
            if (!config.testing) {
                if (priceBackoff[msg.channel.id]) {
                    return;
                }
                priceBackoff[msg.channel.id] = true;
                setTimeout(() => priceBackoff[msg.channel.id] = false, (config.priceBackoff || 60) * 1000);
            }
            const [cmc, ...exchanges] = await Promise.all([await prices.cmc(), ...Object.keys(prices.exchanges).map(x => prices.exchanges[x]())]);
            const embed = {};
            embed.description = `**${cmc.btc} BTC - $${cmc.usd} USD**\n` +
                `Market cap: $${cmc.market_cap} USD (#${cmc.cap_rank})\n` +
                `24h volume: $${cmc.volume} USD\n1 BTC = $${cmc.btcusd} USD`;
            if (cmc.percent_change_1h < 0) {
                embed.color = 0xed2939; // imperial red
            } else if (cmc.percent_change_1h > 0) {
                embed.color = 0x39ff14; // neon green
            }
            embed.fields = [];
            for (let exchange of exchanges) {
                embed.fields.push({
                    name: exchange.name,
                    value: exchange.price + ' BTC',
                    inline: true
                });
            }
            await msg.channel.send(new Discord.RichEmbed(embed));
        } else if (parts[0] === '!mute' && parts[1]) {
            if (!isMod) {
                return;
            }
            let duration = parseFloat(parts[1]);
            const sinbinRole = msg.guild.roles.find('name', config.sinbinRole);
            if (!sinbinRole) return;
            if (!duration || duration <= 0) return;
            duration = duration * 60 * 1000;
            if (!msg.mentions.members) return;
            const {successful, errored} = await modifyRole(sinbinRole, msg.mentions.members.array(), true);
            if (!successful.length && !errored.length) {
                return;
            }
            for (let member of successful) {
                // member.id might change if the user leaves then re-joins
                let permanentId = msg.guild.id + ' ' + member.user.id;
                if (muted[permanentId] !== undefined) {
                    clearTimeout(muted[permanentId].timeout);
                }
                const timeout = setTimeout(() => {
                    member.removeRole(sinbinRole);
                    delete muted[permanentId];
                    saveMuted();
                }, duration);
                muted[permanentId] = {
                    timeout,
                    endsAt: Date.now() + duration,
                };
            }
            saveMuted();
            let message = '';
            if (successful.length) {
                message += 'Muted ';
                message += successful.map(x => '<@' + x.id + '>').join(', ');
                if (parseFloat(parts[1]) === 1) {
                    message += ' for 1 minute.';
                } else {
                    message += ' for ' + parts[1] + ' minutes. ';
                }
            }
            if (errored.length) {
                message += 'Failed to mute ';
                message += errored.map(x => '<@' + x.id + '>').join(', ');
                message += '. <@' + config.ownerId + '> check logs and investigate.';
            }
            msg.channel.send(message);
        } else if (parts[0] === '!unmute') {
            if (!isMod) {
                return;
            }
            const sinbinRole = msg.guild.roles.find('name', config.sinbinRole);
            if (!sinbinRole) return;
            if (!msg.mentions.members) return;
            const {successful, errored} = await modifyRole(sinbinRole, msg.mentions.members.array(), false);
            if (!successful.length && !errored.length) {
                return;
            }
            for (let member of successful) {
                let permanentId = msg.guild.id + ' ' + member.user.id;
                if (muted[permanentId] !== undefined) {
                    const mutedInfo = muted[permanentId];
                    clearTimeout(mutedInfo.timeout);
                    delete muted[permanentId];
                }
            }
            saveMuted();
            let message = '';
            if (successful.length) {
                message += 'Unmuted ';
                message += successful.map(x => '<@' + x.id + '>').join(', ');
                message += '. ';
            }
            if (errored.length) {
                message += 'Failed to unmute ';
                message += errored.map(x => '<@' + x.id + '>').join(', ');
                message += '. <@' + config.ownerId + '> check logs and investigate.';
            }
            msg.channel.send(message);
        } else if (parts[0] === '!disableserious') {
            if (!isMod) {
                return;
            }
            const disableSeriousRole = msg.guild.roles.find('name', config.disableSeriousRole);
            if (!disableSeriousRole || !msg.mentions.members) return;
            const {successful, errored} = await modifyRole(disableSeriousRole, msg.mentions.members.array(), true);
            if (!successful.length && !errored.length) {
                return;
            }
            let message = '';
            if (successful.length) {
                message += 'Disabled serious for ';
                message += successful.map(x => '<@' + x.id + '>').join(', ');
                message += '.';
            }
            if (errored.length) {
                message += 'Failed to disable serious for ';
                message += errored.map(x => '<@' + x.id + '>').join(', ');
                message += '. <@' + config.ownerId + '> check logs and investigate.';
            }
            msg.channel.send(message);
        } else if (parts[0] === '!enableserious') {
            if (!isMod) {
                return;
            }
            const disableSeriousRole = msg.guild.roles.find('name', config.disableSeriousRole);
            if (!disableSeriousRole || !msg.mentions.members) return;
            const {successful, errored} = await modifyRole(disableSeriousRole, msg.mentions.members.array(), false);
            if (!successful.length && !errored.length) {
                return;
            }
            let message = '';
            if (successful.length) {
                message += 'Enabled serious for ';
                message += successful.map(x => '<@' + x.id + '>').join(', ');
                message += '.';
            }
            if (errored.length) {
                message += 'Failed to enable serious for ';
                message += errored.map(x => '<@' + x.id + '>').join(', ');
                message += '. <@' + config.ownerId + '> check logs and investigate.';
            }
            msg.channel.send(message);
        }
    } catch (err) {
        console.error(err);
    }
});

client.on('guildMemberAdd', member => {
    try {
        let permanentId = member.guild.id + ' ' + member.user.id;
        if (muted[permanentId] !== undefined) {
            const mutedInfo = muted[permanentId];
            clearTimeout(mutedInfo.timeout);
            const duration = mutedInfo.endsAt - Date.now();
            if (duration && duration >= 0) {
                const sinbinRole = member.guild.roles.find('name', config.sinbinRole);
                if (!sinbinRole) return;
                member.addRole(sinbinRole);
                mutedInfo.timeout = setTimeout(() => {
                    member.removeRole(sinbinRole);
                    delete muted[permanentId];
                    saveMuted();
                }, duration);
            } else {
                delete muted[permanentId];
                saveMuted();
            }
        }
    } catch (err) {
        console.error(err);
    }
});

client.login(config.token).then(() => {
    try {
        const mutedToDelete = [];
        for (const [permanentId, mutedInfo] of Object.entries(muted)) {
            const [guildId, userId] = permanentId.split(' ');
            const guild = client.guilds.get(guildId);
            if (!guild || !guild.available) continue;
            const sinbinRole = guild.roles.find('name', config.sinbinRole);
            if (!sinbinRole) continue;
            const member = guild.members.get(userId);
            if (!member) continue;
            const duration = mutedInfo.endsAt - Date.now();
            if (duration && duration >= 0) {
                mutedInfo.timeout = setTimeout(() => {
                    member.removeRole(sinbinRole);
                    delete muted[permanentId];
                    saveMuted();
                }, duration);
            } else {
                member.removeRole(sinbinRole);
                mutedToDelete.push(guildId + ' ' + userId);
            }
        }
        for (const key of mutedToDelete) {
            delete muted[key];
        }
    } catch (err) {
        console.error(err);
    }
});
