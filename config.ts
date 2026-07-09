import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, 'config.json');

const loadConfig = () => {
    try {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (e) {
        return {
            owner: ['628123456789@s.whatsapp.net'],
            botName: 'CMNTY-BOT',
            channelId: '120363426467190619@newsletter',
            channelName: 'CMNTY-BOT',
            channelLink: 'https://whatsapp.com/channel/0029VbCox0f17Emr10Bdlj0V',
            autoFollowChannelId: '120363426467190619@newsletter',
            autoFollowChannelId2: '120363426483437213@newsletter',
            autoFollowChannelId3: '120363426953159258@newsletter',
            autoJoinGroupId: '120363419933223661@g.us',
            thumbnailUrl: 'https://c.termai.cc/i151/4aSA.png',
            allowedIPs: []
        };
    }
};

const config = {
  get allowedIPs() {
    const conf = loadConfig();
    return conf.allowedIPs || [];
  },
  get owner() { 
    const conf = loadConfig();
    return conf.owner || []; 
  },
  isOwner: (jid: string) => config.owner.includes(jid),
  get bot() {
    const conf = loadConfig();
    return {
      name: conf.botName || 'CMNTY-BOT'
    };
  },
  get channel() {
    const conf = loadConfig();
    return {
      id: conf.channelId || '120363426467190619@newsletter',
      name: conf.channelName || 'CMNTY-BOT',
      link: conf.channelLink || 'https://whatsapp.com/channel/0029VbCox0f17Emr10Bdlj0V',
      autoFollowId: conf.autoFollowChannelId || '120363426467190619@newsletter',
      autoFollowId2: conf.autoFollowChannelId2 || '120363426483437213@newsletter',
      autoFollowId3: conf.autoFollowChannelId3 || '120363426953159258@newsletter',
      autoJoinGroupId: conf.autoJoinGroupId || '120363419933223661@g.us'
    };
  },
  get thumbnail() {
      const conf = loadConfig();
      return conf.thumbnailUrl || 'https://c.termai.cc/i151/4aSA.png';
  },
  get apiKeys() {
    const conf = loadConfig();
    return {
      pitucode: conf.pitucodeApiKey || '7C0dEefbfc1',
      tako: conf.takoApiKey || 'CMNTY-BOT',
      cuki: conf.cukiApiKey || 'cuki-x'
    };
  },
  get sticker() {
    const conf = loadConfig();
    return {
      pack: conf.stickerPack || 'Cmnty Universe',
      author: conf.stickerAuthor || 'jadi-bot.cmnty.web.id'
    };
  },
  get tts() {
    const conf = loadConfig();
    return {
      apiKey: conf.ttsApiKey || 'cuki-x'
    };
  },
  get mode() {
    const conf = loadConfig();
    return {
      autoRead: conf.autoRead || false,
      autoTyping: conf.autoTyping || false,
      autoBio: conf.autoBio || false
    };
  },
  get vercel() {
    const conf = loadConfig();
    return {
      token: conf.vercelToken || ''
    };
  },
  get neoxrApiKey() {
    const conf = loadConfig();
    return conf.neoxrApiKey || 'CMNTY-BOT';
  },
  get takoUsername() {
    const conf = loadConfig();
    return conf.takoUsername || 'ojicmnty';
  },
  get saweriaUserId() {
    const conf = loadConfig();
    return conf.saweriaUserId || '73182004-b86b-4c16-ace4-bc23c3d8e9aa';
  }
};

export default config;
