const Discord = require('discord.js');
const client = new Discord.Client();

const config = require('./config.json');

const modRoles = ['Moderators', 'Community Managers', 'Core'];

const muted = {};

client.on('message', msg => {
    try {
        if (!msg.guild || !msg.guild.available || !msg.member) return;
        if (!msg.member.roles.some(r => modRoles.includes(r.name))) {
            return;
        }
        const parts = msg.content.split(' ');
        if (parts[0] === '!mute' && parts[1]) {
            let duration = parseFloat(parts[1]);
            const sinBinRole = msg.guild.roles.find('name', 'Sinbin');
            if (!sinBinRole) return;
            if (!duration || duration <= 0) return;
            duration = duration * 60 * 1000;
            if (!msg.mentions.members) return;
            let addRolePromises = [];
            for (let member of msg.mentions.members.array()) {
                addRolePromises.push(member.addRole(sinBinRole)
                    .then(() => [member, false])
                    .catch(err => {
                        console.error(err);
                        return [member, true];
                    }));
                // member.id might change if the user leaves then re-joins
                let permanentId = msg.guild.id + member.user.id;
                if (muted[permanentId] !== undefined) {
                    clearTimeout(muted[permanentId].timeout);
                }
                const timeout = setTimeout(() => member.removeRole(sinBinRole), duration);
                muted[msg.guild.id + member.user.id] = {
                    timeout,
                    endsAt: Date.now() + duration,
                };
            }
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
            const sinBinRole = msg.guild.roles.find('name', 'Sinbin');
            if (!sinBinRole) return;
            if (!msg.mentions.members) return;
            let removeRolePromises = [];
            for (let member of msg.mentions.members.array()) {
                removeRolePromises.push(member.addRole(sinBinRole)
                    .then(() => [member, false])
                    .catch(err => {
                        console.error(err);
                        return [member, true];
                    }));
                let permanentId = msg.guild.id + member.user.id;
                member.removeRole(sinBinRole);
                if (muted[permanentId] !== undefined) {
                    const mutedInfo = muted[permanentId];
                    clearTimeout(mutedInfo.timeout);
                    delete muted[permanentId];
                }
            }
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
        let permanentId = member.guild.id + member.user.id;
        if (muted[permanentId] !== undefined) {
            const mutedInfo = muted[permanentId];
            clearTimeout(mutedInfo.timeout);
            let duration = mutedInfo.endsAt - Date.now();
            if (duration && duration >= 0) {
                const sinBinRole = member.guild.roles.find('name', 'SinBin');
                if (!sinBinRole) return;
                member.addRole(sinBinRole);
                setTimeout(() => member.removeRole(sinBinRole), duration);
            }
        }
    } catch (err) {
        console.error(err);
    }
});

client.login(config.token);
