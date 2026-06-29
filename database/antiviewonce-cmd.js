const { handleAntiViewOnce, setAntiViewOnce } = require('./antiviewonce');

module.exports = {
  name: 'antiviewonce',
  aliases: ['av', 'antivv', 'vv'],
  category: 'group',
  usage: 'antiviewonce [on|off]',
  description: 'Toggle anti-view-once feature in the group',
  
  async execute(sock, message, args, senderInfo) {
    const from = message.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const sender = message.key.participant || message.key.remoteJid;
    
    // Check if sender is admin (group only)
    if (isGroup) {
      const groupMetadata = await sock.groupMetadata(from);
      const participants = groupMetadata.participants;
      const isAdmin = participants.some(p => 
        p.id === sender && (p.admin === 'admin' || p.admin === 'superadmin')
      );
      
      if (!isAdmin) {
        return await sock.sendMessage(from, {
          text: '❌ Only group admins can toggle this feature.'
        }, { quoted: message });
      }
    }

    if (!args || args.length === 0) {
      // Show current status
      const status = /* get from DB */ true; // Replace with actual DB check
      return await sock.sendMessage(from, {
        text: `📸 *Anti-ViewOnce*\n\nCurrent status: ${status ? '✅ Enabled' : '❌ Disabled'}\n\nUsage: \`antiviewonce on\` | \`antiviewonce off\``
      }, { quoted: message });
    }

    const option = args[0].toLowerCase();
    
    if (option === 'on') {
      // Save to DB - adapt to your DB structure
      // global.db.data.groups[from].antiviewonce = true;
      // await global.db.write();
      
      await sock.sendMessage(from, {
        text: '✅ Anti-ViewOnce has been *enabled* for this group.\nView-once media will be automatically captured and re-sent.'
      }, { quoted: message });
      
    } else if (option === 'off') {
      // Save to DB - adapt to your DB structure
      // global.db.data.groups[from].antiviewonce = false;
      // await global.db.write();
      
      await sock.sendMessage(from, {
        text: '❌ Anti-ViewOnce has been *disabled* for this group.'
      }, { quoted: message });
      
    } else {
      await sock.sendMessage(from, {
        text: 'Invalid option. Use `antiviewonce on` or `antiviewonce off`.'
      }, { quoted: message });
    }
  }
};
