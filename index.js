const fs = require('fs');
const Discord = require('discord.js');
const client = new Discord.Client();

const config = require('./config.json');

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

client.on('message', msg => {
    try {
        if (!msg.guild || !msg.guild.available || !msg.member) return;
        if (!msg.member.roles.some(r => config.modRoles.includes(r.name))) {
            return;
        }
        const parts = msg.content.split(' ');
        if (parts[0] === '!mute' && parts[1]) {
            let duration = parseFloat(parts[1]);
            const sinbinRole = msg.guild.roles.find('name', config.sinbinRole);
            if (!sinbinRole) return;
            if (!duration || duration <= 0) return;
            duration = duration * 60 * 1000;
            if (!msg.mentions.members) return;
            let addRolePromises = [];
            for (let member of msg.mentions.members.array()) {
                if (member.roles.some(r => config.modRoles.includes(r.name))) {
                    // ignore mods
                    continue;
                }
                addRolePromises.push(member.addRole(sinbinRole)
                    .then(() => [member, false])
                    .catch(err => {
                        console.error(err);
                        return [member, true];
                    }));
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
            Promise.all(addRolePromises).then(results => {
                if (!results.length) return;
                const successful = results.filter(x => !x[1]).map(x => x[0]);
                const errored = results.filter(x => x[1]).map(x => x[0]);
                let message = '';
                if (successful.length) {
                    message += 'Muted ';
                    message += successful.map(x => '<@' + x.id + '>').join(', ');
                    message += ' for ' + parts[1] + ' minute(s). ';
                }
                if (errored.length) {
                    message += 'Failed to mute ';
                    message += errored.map(x => '<@' + x.id + '>').join(', ');
                    message += '. <@' + config.ownerId + '> check logs and investigate.';
                }
                if (message.length) {
                    msg.channel.send(message);
                }
            });
        } else if (parts[0] === '!unmute') {
            const sinbinRole = msg.guild.roles.find('name', config.sinbinRole);
            if (!sinbinRole) return;
            if (!msg.mentions.members) return;
            let removeRolePromises = [];
            for (let member of msg.mentions.members.array()) {
                removeRolePromises.push(member.addRole(sinbinRole)
                    .then(() => [member, false])
                    .catch(err => {
                        console.error(err);
                        return [member, true];
                    }));
                let permanentId = msg.guild.id + ' ' + member.user.id;
                member.removeRole(sinbinRole);
                if (muted[permanentId] !== undefined) {
                    const mutedInfo = muted[permanentId];
                    clearTimeout(mutedInfo.timeout);
                    delete muted[permanentId];
                }
            }
            saveMuted();
            Promise.all(removeRolePromises).then(results => {
                if (!results.length) return;
                const successful = results.filter(x => !x[1]).map(x => x[0]);
                const errored = results.filter(x => x[1]).map(x => x[0]);
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
                if (message.length) {
                    msg.channel.send(message);
                }
            });
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
