import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { request } from "undici";
import { bratVid } from "brat-canvas/video";
import os from "os";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  proto,
  prepareWAMessageMedia,
  downloadContentFromMessage,
  downloadMediaMessage,
  getContentType,
  generateWAMessageContent,
  generateWAMessageFromContent,
} from "@whiskeysockets/baileys";
import NodeCache from "node-cache";
import pino from "pino";
import fs from "fs";
import crypto from "crypto";
import { Boom } from "@hapi/boom";
import axios from "axios";
import gtts from "gtts";
import * as cheerio from "cheerio";
import config from "./config.ts";
import moment from "moment-timezone";
import { parsePhoneNumber } from "awesome-phonenumber";
import { getDatabase } from "./src/lib/database.ts";
import { GroupData } from "./src/lib/database.ts";
import { db } from "./src/lib/firebase.ts";
import { initSholatScheduler } from "./src/lib/sholat-scheduler.ts";
import { getTodaySchedule, extractPrayerTimes, searchKota } from "./src/lib/sholat-api.ts";
import { capcut, fbdown, snackvideo } from "btch-downloader";
import FormData from "form-data";
import sharp from "sharp";
import { Sticker, StickerTypes } from "wa-sticker-formatter";
import ffmpeg from "fluent-ffmpeg";
import fse from "fs-extra";
import cron from "node-cron";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { performance } from "perf_hooks";
import { createCanvas } from "@napi-rs/canvas";
import yts from "yt-search";
import AdmZip from "adm-zip";
import mime from "mime-types";
import { fileTypeFromBuffer } from "file-type";
import { UPLOADERS } from "./src/lib/multi_uploader.ts";
import { upload, getStatus } from "./src/lib/hd.ts";
import { createWelcomeCardV4, createGoodbyeCardV4 } from "./src/lib/cmnty-welcome-card.ts";
import { addExifToWebp } from "./src/lib/cmnty-exif.ts";
import { tiktokSearchVideo } from "./src/lib/tiktoksearch.ts";

const writeExifImg = addExifToWebp;

const DEFAULT_BLOCKED_LINKS = [
    'chat.whatsapp.com',
    'wa.me',
    'bit.ly',
    't.me',
    'telegram.me',
    'discord.gg',
    'discord.com/invite',
    'whatsapp.com/channel'
];

const execPromise = promisify(exec);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractToken(payload: any = {}) {
  return (
    payload?.token?.result?.token ||
    payload?.result?.token ||
    payload?.data?.result?.token ||
    payload?.data?.token ||
    payload?.result ||
    payload?.token ||
    null
  );
}

function normalizeUrl(url: any) {
    if (!url || typeof url !== 'string') return null
    const matches = url.match(/https?:\/\//g) || []
    if (matches.length <= 1) return url
    const lastIndex = url.lastIndexOf('http')
    return url.slice(lastIndex)
}

function normalizeNumber(value: any) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
}

function normalizeItem(item: any) {
    return {
        title: item?.title || '',
        cover: normalizeUrl(item?.cover),
        originCover: normalizeUrl(item?.origin_cover),
        link: normalizeUrl(item?.link),
        watermarkLink: normalizeUrl(item?.watermark_link),
        music: normalizeUrl(item?.music),
        author: {
            nickname: item?.author?.nickname || '',
            avatar: normalizeUrl(item?.author?.avatar)
        },
        stats: {
            plays: normalizeNumber(item?.stats?.plays),
            likes: normalizeNumber(item?.stats?.likes),
            comments: normalizeNumber(item?.stats?.comments),
            shares: normalizeNumber(item?.stats?.shares)
        }
    }
}

async function handleGameWin(m: any, sock: any, deviceId: string, chatId: string, gameName: string, answer: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const senderJid = m.key.participant || m.key.remoteJid;
    
    // 1. Update Score
    const userData = await getDatabase().getUser(senderJid);
    const oldScore = userData.score || 0;
    const newScore = oldScore + 1;
    const oldLevel = Math.floor(oldScore / 5);
    const newLevel = Math.floor(newScore / 5);
    
    await getDatabase().setUser(senderJid, { score: newScore, level: newLevel });
    
    // 2. Check Level Up
    if (newLevel > oldLevel) {
        let avatarUrl = "https://avatars.githubusercontent.com/u/159487561?v=4";
        try {
           avatarUrl = await sock.profilePictureUrl(senderJid, 'image');
        } catch(e) {}
        
        const userName = m.pushName || "WA User";
        const backgroundURL = "https://i.ibb.co.com/2jMjYXK/IMG-20250103-WA0469.jpg";
        
        const canvaApiUrl = `https://api.siputzx.my.id/api/canvas/level-up?backgroundURL=${encodeURIComponent(backgroundURL)}&avatarURL=${encodeURIComponent(avatarUrl)}&fromLevel=${oldLevel}&toLevel=${newLevel}&name=${encodeURIComponent(userName)}`;
        
        try {
            await sock.sendMessage(chatId, { 
                image: { url: canvaApiUrl },
                caption: `🎉 ✨ *Lᴇᴠᴇʟ Uᴘ!* ✨ 🎉\n\n> Selamat *${userName}*!\n> Level: *${oldLevel}* ➔ *${newLevel}*\n\nKamu hebat! 🔥`,
                contextInfo: {
                    ...getContextInfo(deviceConfig, m),
                    forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (err) {
             console.error("Canva API call failed:", err);
        }
    }
}

async function toOggOpus(inputBuf: Buffer) {

    const tmp = path.join(process.cwd(), "temp")
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true })
    const id = crypto.randomBytes(6).toString("hex")
    const inp = path.join(tmp, `upch_in_${id}`)
    const out = path.join(tmp, `upch_out_${id}.ogg`)
    fs.writeFileSync(inp, inputBuf)
    try {
        await execPromise(`ffmpeg -y -i "${inp}" -vn -map_metadata -1 -ac 1 -ar 48000 -c:a libopus -b:a 96k -vbr on -application audio -f ogg "${out}"`)
        const buf = fs.readFileSync(out)
        return buf
    } finally {
        try { if (fs.existsSync(inp)) fs.unlinkSync(inp) } catch {}
        try { if (fs.existsSync(out)) fs.unlinkSync(out) } catch {}
    }
}

async function bypassCloudflare({
  url,
  mode = "turnstile-min",
  siteKey,
  timeout = 60000,
}: { url: string; mode?: string; siteKey?: string; timeout?: number }) {
  const endpoint = "https://kyuurzy.dev/tools/turnstile-min";
  const payload = {
    url: String(url),
    siteKey,
  };

  const { data } = await axios.get(endpoint, {
    params: payload,
    headers: {
      "Content-Type": "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
    timeout,
  });

  return data;
}

let lastLive3dCall = 0;

async function live3d(
  imageBuffer: Buffer,
  prompt: string = "Make this person the skin is very black, but skin tone still natural",
) {
  const now = Date.now();
  const delay = Math.max(0, lastLive3dCall + 20000 - now);
  if (delay > 0) await sleep(delay);
  lastLive3dCall = Date.now();

  const bypassPayload = await bypassCloudflare({
    url: "https://www.createimg.com/change-skin-color/",
    siteKey: "0x4AAAAAABggkaHPwa2n_WBx",
  });

  const token = extractToken(bypassPayload);
  const cookies = bypassPayload?.result?.cookies || [];
  const cfClearance = cookies.find((c: any) => c.name === "cf_clearance")?.value;

  if (!token) throw new Error("Gagal mendapatkan Token.");

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://www.createimg.com",
    Referer: "https://www.createimg.com/change-skin-color/",
    Cookie: `pll_language=en${cfClearance ? `; cf_clearance=${cfClearance}` : ""}`,
    "X-Requested-With": "XMLHttpRequest",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    Priority: "u=4",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
  };

  const uuid = "d8ca3b2fce8fd289718953aa11a34682";

  const form = new FormData();
  form.append("token", token);
  form.append("uuid", uuid);
  form.append("prompt", prompt);
  form.append("negative", "");
  form.append("seed", "190703539");
  form.append("resolution", "hd");
  form.append("dimension", "portrait");
  form.append("image", imageBuffer, {
    filename: "blob",
    contentType: "image/webp",
  });
  form.append("module", "edit");

  const generateRes = await axios.post(
    "https://www.createimg.com/?generate=v1",
    form,
    { headers: { ...headers, ...form.getHeaders() } },
  );

  if (!generateRes.data.success) {
    throw new Error(generateRes.data.message || "Invalid Request");
  }

  const taskId = generateRes.data.id;

  let base64Result = null;
  for (let i = 0; i < 20; i++) {
    await sleep(5000);

    const outForm = new FormData();
    outForm.append("id", taskId);
    outForm.append("uuid", uuid);

    const outRes = await axios.post(
      "https://www.createimg.com/?output=v1",
      outForm,
      { headers: { ...headers, ...outForm.getHeaders() } },
    );

    if (outRes.data.success && outRes.data.message) {
      base64Result = outRes.data.message;
      break;
    }
  }

  if (!base64Result) throw new Error("Render timeout.");

  const base64Data = base64Result.replace(/^data:image\/\w+;base64,/, "");
  const image = Buffer.from(base64Data, "base64");

  return { image };
}

function roundedRectPath(ctx: any, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawAvatar(ctx: any, img: any, x: number, y: number, size: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
}

function drawCoverImage(ctx: any, img: any, x: number, y: number, w: number, h: number) {
  const imgRatio = img.width / img.height;
  const canvasRatio = w / h;
  let drawW, drawH, drawX, drawY;
  if (imgRatio > canvasRatio) {
    drawH = h;
    drawW = h * imgRatio;
    drawX = x - (drawW - w) / 2;
    drawY = y;
  } else {
    drawW = w;
    drawH = w / imgRatio;
    drawX = x;
    drawY = y - (drawH - h) / 2;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();
}

function drawBlurredBackground(ctx: any, canvas: any, img: any) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  (ctx as any).filter = "blur(30px) brightness(30%)";
  const bleed = 40;
  drawCoverImage(ctx, img, -bleed, -bleed, w + bleed * 2, h + bleed * 2);
  ctx.restore();
}

const renderLatexToPng = async (latex: string, options: any = {}) => {
  const bgColor = options.bgColor || "#1a1a2e";
  const dpi = options.dpi || 200;
  const url = `https://latex.codecogs.com/png.image?\\dpi{${dpi}}\\bg{${bgColor.replace("#", "")}} ${encodeURIComponent(latex)}`;
  const res = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
};

const mediafire = async (url: string) => {
  const { data: html } = await axios.get(url, {
    timeout: 60000,
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("title").text().trim() ||
    "MediaFire File";
  const images = $('meta[property="og:image"]').attr("content") || "";
  const description =
    $('meta[property="og:description"]').attr("content") ||
    "not found description.";
  const link_download =
    $("#downloadButton").attr("href") ||
    $('a[aria-label="Download file"]').attr("href") ||
    "";
  const sizes = $("#downloadButton").text().trim();
  const sizeMatch = sizes.match(/\(([^)]+)\)/);
  const size = sizeMatch?.[1]?.trim() || "";
  
  const mimetypes: { [key: string]: string } = {
    "7z": "application/x-7z-compressed",
    zip: "application/zip",
    rar: "application/x-rar-compressed",
    apk: "application/vnd.android.package-archive",
    exe: "application/x-msdownload",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    txt: "text/plain",
    json: "application/json",
    js: "application/javascript",
    html: "text/html",
    css: "text/css",
  };

  const extension = link_download ? link_download.split("/").pop()?.split("?")[0]?.split(".").pop()?.toLowerCase() || "" : "";
  const mimetype = mimetypes[extension] || "application/octet-stream";

  if (!link_download) {
    throw new Error("MediaFire download link not found");
  }

  return {
    meta: {
      title,
      images,
      description,
    },
    download: {
      link_download,
      size,
      mimetype,
    },
  };
};

async function createFakeStory(username: string, avatarBuffer: Buffer, imageBuffer: Buffer) {
  const { createCanvas, loadImage, Path2D } = await import("@napi-rs/canvas");
  const width = 720;
  const height = 1150;
  const canvasConfig = {
    cardBg: "#121212",
    textColor: "#ffffff",
    cornerRadius: 35,
  };
  const icons = {
    heart: "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
    comment: "M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z",
    share: "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z",
    options: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  };

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const avatar = await loadImage(avatarBuffer);
  const img = await loadImage(imageBuffer);

  drawBlurredBackground(ctx, canvas, img);

  const cardMarginX = 25;
  const cardMarginY = 60;
  const cardW = width - cardMarginX * 2;
  const cardH = height - cardMarginY * 2;
  const cardX = cardMarginX;
  const cardY = cardMarginY;

  ctx.save();
  roundedRectPath(ctx, cardX, cardY, cardW, cardH, canvasConfig.cornerRadius);
  ctx.fillStyle = canvasConfig.cardBg;
  ctx.fill();
  ctx.clip();

  const headerHeight = 90;
  const avatarSize = 45;
  drawAvatar(ctx, avatar, cardX + 20, cardY + 22, avatarSize);

  ctx.font = "bold 18px Arial";
  ctx.fillStyle = canvasConfig.textColor;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(username, cardX + 80, cardY + 45);

  ctx.save();
  ctx.translate(cardX + cardW - 40, cardY + 45);
  ctx.rotate((90 * Math.PI) / 180);
  const pOpts = new Path2D(icons.options);
  ctx.fillStyle = "white";
  ctx.fill(pOpts);
  ctx.restore();

  const footerHeight = 70;
  const contentHeight = cardH - headerHeight - footerHeight;
  drawCoverImage(ctx, img, cardX, cardY + headerHeight, cardW, contentHeight);

  const iconY = cardY + cardH - footerHeight / 2;
  function drawSvgOutline(pathData: string, x: number, y: number, scale: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.translate(-12, -12);
    const p = new Path2D(pathData);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.8;
    ctx.stroke(p);
    ctx.restore();
  }
  drawSvgOutline(icons.heart, cardX + 40, iconY, 1.3);
  drawSvgOutline(icons.comment, cardX + 100, iconY, 1.2);
  drawSvgOutline(icons.share, cardX + 160, iconY, 1.2);

  ctx.restore();
  return await canvas.encode("png");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const regionNames = new Intl.DisplayNames(["id"], {
  type: "region",
});

// Global Error Handling to prevent crashes from unhandled promises
process.on("unhandledRejection", (reason, promise) => {
  const errorMsg = reason instanceof Error ? reason.message : String(reason);
  if (errorMsg.includes("Failed to decrypt") || errorMsg.includes("MessageCounterError") || errorMsg.includes("Session error") || errorMsg.includes("Connection Closed")) return;
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  if (errorMsg.includes("Failed to decrypt") || errorMsg.includes("MessageCounterError") || errorMsg.includes("Session error") || errorMsg.includes("Connection Closed")) return;
  console.error("Uncaught Exception thrown:", err);
});

const sessionsDir = path.join(__dirname, "sessions");
if (!fs.existsSync(sessionsDir)) {
  fs.mkdirSync(sessionsDir, { recursive: true });
}

// Multi-instance state management
interface BotInstance {
  activeSocket: any;
  activeQrCode: string | null;
  connectionStatus: "disconnected" | "connecting" | "connected";
  lastReconnectTime: number;
  messagesProcessed: number;
  activeGroupsCount: number;
  connectedTime: number;
  _channelFollowInterval?: any;
  systemLogs: {
    time: string;
    message: string;
    type: "info" | "warn" | "error" | "success";
  }[];
  userProfileCache: {
    id: string;
    name: string;
    profilePic: string | null;
    lastFetch?: number;
  } | null;
  config: any;
  user?: { id: string; name: string, profilePic?: string | null };
  status?: "disconnected" | "connecting" | "connected";
  lastActivity: number;
}

const instances = new Map<string, BotInstance>();
const rateLimits = new Map<string, number[]>();

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} hari ${hours % 24} jam ${minutes % 60} menit`;
  if (hours > 0) return `${hours} jam ${minutes % 60} menit`;
  if (minutes > 0) return `${minutes} menit ${seconds % 60} detik`;
  return `${seconds} detik`;
}

function formatTimestamp(ms: number) {
  return new Date(ms).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatTime(t: string | undefined) {
    if (!t) return null;
    let [h, m] = t.replace(/[:.]/, '.').split('.');
    if (!h || isNaN(parseInt(h))) return null;
    if (!m) m = "00";
    const hh = parseInt(h).toString().padStart(2, '0');
    const mm = parseInt(m).toString().padStart(2, '0');
    if (parseInt(hh) > 23 || parseInt(mm) > 59) return null;
    return `${hh}.${mm}`;
}
const pendingSwgc = new Map<string, {
  rawContent: any;
  tempFile?: string;
  timestamp: number;
}>();

async function sendGroupStatus(sock: any, jid: string, content: any) {
    const inside = await generateWAMessageContent(content, {
        upload: sock.waUploadToServer
    });
    const messageSecret = crypto.randomBytes(32);
    const m = generateWAMessageFromContent(jid, {
        messageContextInfo: {
            messageSecret
        },
        groupStatusMessageV2: {
            message: {
                ...inside,
                messageContextInfo: {
                    messageSecret
                }
            }
        }
    }, { userJid: sock.user.id });
    await sock.relayMessage(jid, m.message!, {
        messageId: m.key.id!
    });
    return m;
}

function getInstance(deviceId: string): BotInstance {
  if (!instances.has(deviceId)) {
    const sessionPath = path.join(sessionsDir, deviceId);
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });
    
    const configPath = path.join(sessionPath, "config.json");
    let devConfig: any = {
        owner: [],
        botName: "CMNTY-BOT",
        bot: { name: "CMNTY-BOT" },
        botMode: "public",
        stickerPack: "Cmnty Universe",
        stickerAuthor: "jadi-bot.cmnty.web.id",
    };

    if (fs.existsSync(configPath)) {
        try {
            devConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (e) {}
    } else {
        // Migration: If main config exists and this is first instance, maybe copy? 
        // For simplicity, we just use defaults for new sessions.
    }

    instances.set(deviceId, {
      activeSocket: null,
      activeQrCode: null,
      connectionStatus: "disconnected",
      lastReconnectTime: 0,
      messagesProcessed: 26048,
      activeGroupsCount: 0,
      connectedTime: 0,
      systemLogs: [],
      userProfileCache: null,
      config: devConfig,
      lastActivity: Date.now()
    });
  }
  return instances.get(deviceId)!;
}

function addSystemLog(
  deviceId: string,
  message: string,
  type: "info" | "warn" | "error" | "success" = "info",
) {
  // Function disabled by user request
}

// Keep-alive/Stay-awake Ping
function startKeepAlive(url: string) {
  setInterval(
    async () => {
      try {
        await fetch(url);
      } catch (e) {}
    },
    5 * 60 * 1000,
  ); // Pulse every 5 minutes
}

const SESSION_ID = "main_session";

const forwardedNewsletterMessageInfo = {
    newsletterJid: '120363426467190619@newsletter',
    newsletterName: 'CMNTY-BOT',
    serverMessageId: 1
};

const mimeTypes = {
  "7z": "application/x-7z-compressed",
  zip: "application/zip",
  rar: "application/x-rar-compressed",
  apk: "application/vnd.android.package-archive",
  exe: "application/x-msdownload",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  txt: "text/plain",
  json: "application/json",
  js: "application/javascript",
  html: "text/html",
  css: "text/css",
};

function getMimeTypeFromUrl(url: string) {
  if (!url) return "application/octet-stream";
  const fileName = url.split("?")[0].split("/").pop() || "";
  const ext = fileName.split(".").pop() || "";
  return (mimeTypes as any)[ext] || "application/octet-stream";
}

function getFileName(url: string, title?: string) {
    if (title) return title.replace(/[/\\?%*:|"<>]/g, '-');
    return url.split("?")[0].split("/").pop() || "downloaded_file";
}

async function facebookdlHandler(m: any, sock: any, url: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!url || !url.includes("facebook.com")) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}facebookdl <url>\`\n\n> Contoh:\n> \`${prefix}fbdown https://www.facebook.com/watch?v=xxx\``
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const data = await fbdown(url);
        
        if (!data?.status) {
            return sock.sendMessage(jid, { text: `❌ Gagal mengambil video. Coba link lain.` }, { quoted: m });
        }
        
        const videoUrl = data.HD || data.Normal_video;
        
        if (!videoUrl) {
            return sock.sendMessage(jid, { text: `❌ Video tidak ditemukan.` }, { quoted: m });
        }
        
        await sock.sendMessage(jid, {
            video: { url: videoUrl },
            caption: `✅ *Facebook Download Successful*`,
            contextInfo: {
                forwardingScore: 99,
                isForwarded: true
            }
        }, { quoted: m });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[FBDown Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function kodeposHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}kodepos <keyword>\`\n\n> Contoh:\n> \`${prefix}kodepos jakarta\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const { data } = await axios.get(`https://api.cuki.biz.id/api/tools/kodepos?apikey=cuki-x&form=${encodeURIComponent(q)}`);
        
        if (!data?.status || !data?.data || data.data.length === 0) {
           await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
           return sock.sendMessage(jid, { text: `❌ Kode pos tidak ditemukan untuk: ${q}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        let resultText = `✅ *ʜᴀsɪʟ ᴘᴇɴᴄᴀʀɪᴀɴ ᴋᴏᴅᴇ ᴘᴏs*\n\n> Keyword: ${q}\n\n`;
        const limitCount = Math.min(data.data.length, 10);
        for(let i = 0; i < limitCount; i++) {
           const item = data.data[i];
           resultText += `╭┈┈⬡\n`;
           resultText += `┃ 🏘️ *Desa:* ${item.desa}\n`;
           resultText += `┃ 🗺️ *Kecamatan:* ${item.kecamatan}\n`;
           resultText += `┃ 🏙️ *Kota/Kab:* ${item.kota}\n`;
           resultText += `┃ 📍 *Provinsi:* ${item.provinsi}\n`;
           resultText += `┃ 📮 *Kode Pos:* ${item.kodepos}\n`;
           resultText += `╰┈┈┈┈┈┈┈┈⬡\n\n`;
        }

        await sock.sendMessage(jid, {
            text: resultText.trim(),
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Kodepos Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function bisakahHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `💪 *ʙɪsᴀᴋᴀʜ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}bisakah aku lulus ujian?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Bisa banget! Percaya diri aja!',
        'Hmm, kayaknya susah deh.',
        'Tentu bisa! Semangat!',
        'Nggak bisa, maaf.',
        'Mungkin bisa, kalau usaha keras.',
        'Pasti bisa! Jangan menyerah!',
        'Agak susah sih, tapi bisa dicoba.',
        'Bisa kok! Yakin deh!',
        'Kayaknya nggak deh.',
        'Bisa! Ayo buktikan!',
        'Hmm... aku ragu.',
        'Bisa banget! Gas terus!',
        'Nggak bisa, coba yang lain.',
        'Bisa! Percaya sama diri sendiri!',
        'Susah, tapi bukan berarti nggak mungkin.',
        'Absolutely! Kamu pasti bisa!',
        'Kayaknya perlu usaha ekstra nih.',
        'Bisa! Jangan ragukan dirimu!',
        'Hmm, coba lagi nanti deh.',
        'Bisa! Aku percaya kamu!'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}bisakah ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function berapaHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `🔢 *ʙᴇʀᴀᴘᴀ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}berapa umur jodohku?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        '1', '7', '12', '21', '99', '69', '100', '50', '25', '1000', '5', '17', '88', '33',
        'nothing (jawabannya selalu nothing)',
        'Banyak banget!',
        'Cuma sedikit.',
        'Tak terhitung!',
        'Hmm, sekitar 10-an.',
        'Lebih dari yang kamu kira!',
        'Gak tau ah, males'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}berapa ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function bagaimanaHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `📋 *ʙᴀɢᴀɪᴍᴀɴᴀ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}bagaimana cara jadi sukses?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Caranya gampang, ya tinggal dilakuin aja!',
        'Hmm, susah dijelasin sih. Coba aja dulu!',
        'Dengan usaha dan doa pastinya.',
        'Ya begitulah caranya.',
        'Aku kurang tau sih, coba cari referensi lain.',
        'Pelan-pelan aja, nanti juga bisa.',
        'Dengan kerja keras dan pantang menyerah!',
        'Pertama, percaya sama diri sendiri dulu.',
        'Hmm, tiap orang beda-beda sih caranya.',
        'Ikutin kata hatimu aja.',
        'Belajar dari yang sudah berpengalaman.',
        'Step by step, jangan terburu-buru.',
        'Dengan tekad yang kuat!',
        'Mulai dari yang kecil dulu.',
        'Konsisten aja, nanti juga bisa.',
        'Jangan overthinking, langsung action!',
        'Gampang! Tinggal mulai aja!',
        'Caranya? Ya dicoba dulu!',
        'Dengan strategi yang tepat.',
        'Hmm, aku juga masih belajar sih.'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}bagaimana ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function apakahHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `❓ *ᴀᴘᴀᴋᴀʜ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}apakah aku bisa jadi kaya?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Ya, tentu saja!',
        'Tidak, sepertinya tidak.',
        'Mungkin saja, coba lagi nanti.',
        'Hmm... aku rasa iya.',
        'Aku ragu, tapi bisa jadi.',
        'Pasti! 100%!',
        'Tidak mungkin.',
        'Bisa jadi, siapa yang tau?',
        'Menurutku sih iya.',
        'Wah, kayaknya nggak deh.',
        'Tentu, kenapa tidak?',
        'Aku nggak tau, coba tanya yang lain.',
        'Ya ampun, pasti lah!',
        'Hmm... sepertinya tidak.',
        'Aku yakin iya!',
        'Nggak mungkin banget.',
        'Mungkin, tapi jangan berharap terlalu tinggi.',
        'Iya dong!',
        'Nggak, maaf ya.',
        'Bisa! Semangat!'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}apakah ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function akankahHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `🔮 *ᴀᴋᴀɴᴋᴀʜ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}akankah aku sukses?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Ya, pasti akan terjadi!',
        'Tidak, sepertinya tidak akan.',
        'Mungkin akan, mungkin tidak.',
        'InsyaAllah akan terjadi!',
        'Hmm, sulit diprediksi.',
        'Pasti! Yakin saja!',
        'Kayaknya nggak deh.',
        'Akan terjadi kalau kamu mau berusaha.',
        'Suatu saat nanti, pasti.',
        'Nggak akan, maaf.',
        'Tentu akan! Tunggu saja!',
        'Hmm, aku ragu.',
        'Akan! Percaya sama proses!',
        'Kemungkinannya kecil.',
        'Pasti akan, aku yakin!',
        'Nggak akan, cari yang lain aja.',
        'Akan, tapi butuh waktu.',
        'InsyaAllah!',
        'Kalau jodoh, pasti akan.',
        'Akan terjadi di saat yang tepat!'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}akankah ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function gayHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    
    if (!jid.endsWith('@g.us')) {
        return sock.sendMessage(jid, { text: `❌ Fitur ini hanya dapat digunakan di dalam grup.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    try {
        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants;
        const members = participants.map((u: any) => u.id);
        
        if (members.length < 2) {
             return sock.sendMessage(jid, { text: `❌ Anggota grup tidak cukup untuk fitur ini.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        const orang1 = members[Math.floor(Math.random() * members.length)];
        const orang2 = members[Math.floor(Math.random() * members.length)];
        const text = `@${orang1.split('@')[0]} *Nge gay sama* @${orang2.split('@')[0]}`;
        
        await sock.sendMessage(jid, {
            text: text,
            mentions: [orang1, orang2],
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    } catch (err: any) {
        console.error("Gay handler error:", err);
        await sock.sendMessage(jid, { text: `❌ Gagal mengambil data grup.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function haruskahHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚖️ *ʜᴀʀᴜsᴋᴀʜ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}haruskah aku menyatakan cinta?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Ya, harus!',
        'Tidak usah.',
        'Hmm, terserah kamu sih.',
        'Harus banget! Jangan ragu!',
        'Nggak harus juga.',
        'Kalau menurutmu perlu, lakukan!',
        'Pikir dulu baik-baik.',
        'Harus! Sekarang!',
        'Jangan, mending tunggu dulu.',
        'Harus, tapi hati-hati.',
        'Nggak harus, tapi boleh.',
        'Wajib!',
        'Hmm, skip aja deh.',
        'Lakukan kalau sudah yakin.',
        'Harus, demi masa depanmu!',
        'Nggak harus, santai aja.',
        'Go for it!',
        'Jangan buru-buru, pikir lagi.',
        'Tentu harus!',
        'Lihat situasinya dulu.'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}haruskah ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function jodohHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    if (!jid.endsWith('@g.us')) {
        return sock.sendMessage(jid, { text: `❌ Fitur ini hanya dapat digunakan di dalam grup.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    try {
        const groupMetadata = await sock.groupMetadata(jid);
        const participants = groupMetadata.participants;
        const members = participants.map((u: any) => u.id);
        
        if (members.length < 2) {
             return sock.sendMessage(jid, { text: `❌ Anggota grup tidak cukup untuk fitur ini.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        const orang1 = members[Math.floor(Math.random() * members.length)];
        let orang2 = members[Math.floor(Math.random() * members.length)];
        
        while (orang1 === orang2) {
            orang2 = members[Math.floor(Math.random() * members.length)];
        }

        const percent = Math.floor(Math.random() * 101);
        
        const loveQuotes = [
          "Cinta sejati tidak pernah mengenal jarak 💕",
          "Dua hati yang bersatu takkan terpisahkan 💗",
          "Kalian seperti puzzle yang sempurna 🧩",
          "Match made in heaven! ✨",
          "Chemistry-nya kuat banget! 🔥",
          "Couple goals banget sih kalian 💑",
          "Destiny brought you together 🌟",
          "Perfect match detected! 💘",
        ];

        const compatibilityEmoji = (percent: number) => {
          if (percent >= 90) return "💕💕💕💕💕";
          if (percent >= 70) return "💕💕💕💕";
          if (percent >= 50) return "💕💕💕";
          if (percent >= 30) return "💕💕";
          return "💕";
        };

        const compatibilityText = (percent: number) => {
          if (percent >= 90) return "JODOH SEJATI! 💍";
          if (percent >= 70) return "Sangat Cocok! 💖";
          if (percent >= 50) return "Lumayan Cocok 💗";
          if (percent >= 30) return "Bisa Dicoba 💓";
          return "Butuh Usaha Lebih 💔";
        };

        const text = `💘 *PENCARIAN JODOH* 💘\n\n` +
                     `@${orang1.split('@')[0]} ❤️ @${orang2.split('@')[0]}\n\n` +
                     `📈 *Tingkat Kecocokan:* ${percent}%\n` +
                     `✨ *Status:* ${compatibilityText(percent)}\n` +
                     `💗 *Rating:* ${compatibilityEmoji(percent)}\n\n` +
                     `> _"${loveQuotes[Math.floor(Math.random() * loveQuotes.length)]}"_`;
        
        await sock.sendMessage(jid, {
            text: text,
            mentions: [orang1, orang2],
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    } catch (err: any) {
        console.error("Jodoh handler error:", err);
        await sock.sendMessage(jid, { text: `❌ Gagal mengambil data grup.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function dimanaHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `📍 *ᴅɪᴍᴀɴᴀ*\n\n> Masukkan pertanyaan!\n\n*Contoh:*\n> ${prefix}dimana jodohku berada?`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Di dekatmu!',
        'Jauh di sana.',
        'Di tempat yang tidak kamu duga.',
        'Di hatimu.',
        'Di sekitar sini.',
        'Hmm, coba cari di kamar.',
        'Di luar sana, menunggumu.',
        'Di tempat yang sama denganmu.',
        'Di suatu tempat yang indah.',
        'Di balik pintu.',
        'Di sebelah kirimu.',
        'Di depan matamu!',
        'Jauh banget, di luar negeri mungkin?',
        'Di tempat yang penuh kenangan.',
        'Di mana-mana!',
        'Di dunia maya.',
        'Di alam mimpi.',
        'Di tempat rahasia.',
        'Hmm, susah dijelaskan lokasinya.',
        'Di tempat yang akan membuatmu bahagia.'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}dimana ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function cobaHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `🎯 *ᴄᴏʙᴀ*\n\n> Masukkan sesuatu!\n\n*Contoh:*\n> ${prefix}coba tebak apa yang aku pikirkan`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const answers = [
        'Hmm, aku coba ya... Kamu lagi mikirin makanan!',
        'Aku tebak... Kamu lagi gabut!',
        'Coba ya... Kayaknya kamu lagi seneng!',
        'Hmm, aku rasa kamu lagi bingung.',
        'Aku tebak... Kamu lagi kangen seseorang?',
        'Kayaknya kamu lagi santai deh.',
        'Aku tebak kamu lagi scroll HP terus.',
        'Hmm, pasti lagi bosan ya?',
        'Coba ditebak... Kamu lagi pengen jalan-jalan!',
        'Aku rasa kamu lagi butuh hiburan.',
        'Hmm, kayaknya kamu lagi happy!',
        'Aku coba... Kamu pasti lagi penasaran!',
        'Tebakan aku: kamu lagi rebahan.',
        'Hmm, kamu mungkin lagi mikirin seseorang spesial.',
        'Aku coba: kamu lagi mau curhat?',
        'Kayaknya kamu lagi pengen main game!',
        'Hmm, aku tebak kamu lagi dengerin musik.',
        'Coba aku tebak... Kamu lagi di kamar!',
        'Aku rasa kamu lagi waiting for something.',
        'Hmm, tebakan aku: kamu butuh temen ngobrol!'
    ];

    const answer = answers[Math.floor(Math.random() * answers.length)];
    const bodyText = m.message?.conversation || m.message?.extendedTextMessage?.text || `${prefix}coba ${q}`;

    await sock.sendMessage(jid, {
        text: `${bodyText.replace(/^[^\w\s]/i, '')}?\n*${answer}*`,
        contextInfo: getContextInfo(deviceConfig, m),
        forwardedNewsletterMessageInfo: {
            newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
            newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
            serverMessageId: 1
        }
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
}

async function confessHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q || !q.includes('|')) {
        return sock.sendMessage(jid, {
            text: `💌 *ᴀɴᴏɴʏᴍᴏᴜs ᴄᴏɴꜰᴇss*\n\n> Kirim pesan anonim ke seseorang!\n\n╭┈┈⬡「 📋 *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ* 」\n┃ Format:\n┃ \`${prefix}confess nomor|pesan\`\n┃\n┃ Contoh:\n┃ \`${prefix}confess 6281234567890|Hai kamu!\`\n╰┈┈┈┈┈┈┈┈⬡\n\n> ⚠️ Identitasmu akan dirahasiakan!`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const [rawNumber, ...messageParts] = q.split('|');
    const message = messageParts.join('|').trim();

    if (!rawNumber || !message) {
        return sock.sendMessage(jid, { text: `❌ Format salah!\n\n> Gunakan: \`${prefix}confess nomor|pesan\``, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    let targetNumber = rawNumber.trim().replace(/[^0-9]/g, '');

    if (targetNumber.startsWith('0')) {
        targetNumber = '62' + targetNumber.slice(1);
    }

    if (targetNumber.length < 10 || targetNumber.length > 15) {
        return sock.sendMessage(jid, { text: `❌ Nomor tidak valid!`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const targetJid = targetNumber + '@s.whatsapp.net';
    const sender = m.key.participant || m.key.remoteJid || "";
    const senderNumber = sender.split('@')[0];

    if (targetNumber === senderNumber) {
        return sock.sendMessage(jid, { text: `❌ Tidak bisa mengirim confess ke diri sendiri!`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    try {
        const [onWa] = await sock.onWhatsApp(targetNumber);
        if (!onWa?.exists) {
            return sock.sendMessage(jid, { text: `❌ Nomor \`${targetNumber}\` tidak terdaftar di WhatsApp!`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }
    } catch (e) {}

    if (message.length < 5) {
        return sock.sendMessage(jid, { text: `❌ Pesan terlalu pendek! Minimal 5 karakter.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    if (message.length > 1000) {
        return sock.sendMessage(jid, { text: `❌ Pesan terlalu panjang! Maksimal 1000 karakter.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const confessText = 
        `💌 *ᴀᴅᴀ ᴘᴇsᴀɴ ᴅᴀʀɪ sᴇsᴇᴏʀᴀɴɢ ɴɪᴄʜʜ*\n\n` +
        `「 📨 *ᴘᴇsᴀɴ: ᴅᴀʀɪ sᴇsᴇᴏʀᴀɴɢ* 」\n` +
        ` 💕 *ɪsɪ ᴘᴇsᴀɴ:*\n` +
        `\`\`\`${message}\`\`\`\n` +
        `> 🔒 _Identitas pengirim dirahasiakan_\n` +
        `> 💬 _Reply pesan ini untuk membalas!_`;

    try {
        const sentMsg = await sock.sendMessage(targetJid, {
            text: confessText,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                    newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                    serverMessageId: 1
                }
            }
        });

        if (sentMsg?.key?.id) {
            if (!(global as any).confessData) (global as any).confessData = new Map();
            (global as any).confessData.set(sentMsg.key.id, {
                senderJid: sender,
                senderChat: jid,
                targetJid: targetJid,
                createdAt: Date.now()
            });

            setTimeout(() => {
                if ((global as any).confessData) {
                    (global as any).confessData.delete(sentMsg.key.id);
                }
            }, 24 * 60 * 60 * 1000);
        }

        await sock.sendMessage(jid, {
            text: `✅ *ᴄᴏɴꜰᴇss ᴛᴇʀᴋɪʀɪᴍ!*\n\n> Pesan dikirim ke: \`${targetNumber}\`\n> Identitasmu terjaga aman! 🔒\n\n> 💬 Jika dia membalas, balasannya akan dikirim ke sini!`,
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });

    } catch (error: any) {
        console.error("Confess error:", error);
        await sock.sendMessage(jid, { text: `❌ Gagal mengirim pesan: ${error.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cekpacarHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";
    const db = getDatabase();

    const senderJid = m.key.participant || jid;
    let targetJid = senderJid;
    let isOther = false;

    if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedJid = m.message.extendedTextMessage.contextInfo.participant;
        if (quotedJid) {
            targetJid = quotedJid;
            isOther = true;
        }
    } else if (m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]) {
        targetJid = m.message.extendedTextMessage.contextInfo.mentionedJid[0];
        isOther = true;
    } else if (q) {
        let num = q.replace(/[^0-9]/g, '');
        if (num.length > 5 && num.length < 20) {
            targetJid = num + '@s.whatsapp.net';
            isOther = true;
        }
    }

    const userData = await db.getUser(targetJid);
    const nama = isOther ? `@${targetJid.split('@')[0]}` : 'Kamu';

    if (!userData.fun?.pasangan) {
        await sock.sendMessage(jid, { react: { text: "💔", key: m.key } });
        return sock.sendMessage(jid, {
            text: `💔 *sᴛᴀᴛᴜs ʜᴜʙᴜɴɢᴀɴ*\n\n*${nama}* tidak punya pasangan.\nTIP: Cari pasangan dulu dengan \`${prefix}tembak @tag\``,
            mentions: isOther ? [targetJid] : [],
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
    
    const partnerJid = userData.fun.pasangan;
    const partnerData = await db.getUser(partnerJid);
    const isMutual = partnerData.fun?.pasangan === targetJid;
    
    if (isMutual) {
        await sock.sendMessage(jid, { react: { text: "💕", key: m.key } });
        await sock.sendMessage(jid, {
            text: `💕 *sᴛᴀᴛᴜs ʜᴜʙᴜɴɢᴀɴ*\n\n*${nama}* sedang pacaran dengan @${partnerJid.split('@')[0]}! 🥳`,
            mentions: [targetJid, partnerJid],
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    } else {
        await sock.sendMessage(jid, { react: { text: "💭", key: m.key } });
        await sock.sendMessage(jid, {
            text: `💭 *sᴛᴀᴛᴜs ʜᴜʙᴜɴɢᴀɴ*\n\n*${nama}* lagi pdkt sama @${partnerJid.split('@')[0]}\nStatus: *Digantung* 😅\n\nMenunggu jawaban...`,
            mentions: [targetJid, partnerJid],
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cekkhodamHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    const KHODAMS = [
        { name: "Harimau Putih", meaning: "Kamu kuat dan berani seperti harimau, karena pendahulumu mewariskan kekuatan besar padamu." },
        { name: "Lampu Tertidur", meaning: "Terlihat ngantuk tapi selalu memberikan cahaya yang hangat" },
        { name: "Panda Ompong", meaning: "Kamu menggemaskan dan selalu berhasil membuat orang tersenyum dengan keanehanmu." },
        { name: "Bebek Karet", meaning: "Kamu selalu tenang dan ceria, mampu menghadapi gelombang masalah dengan senyum." },
        { name: "Ninja Turtle", meaning: "Kamu lincah dan tangguh, siap melindungi yang lemah dengan kekuatan tempurmu." },
        { name: "Kucing Kulkas", meaning: "Kamu misterius dan selalu ada di tempat-tempat yang tak terduga." },
        { name: "Sabun Wangi", meaning: "Kamu selalu membawa keharuman dan kesegaran di mana pun kamu berada." },
        { name: "Semut Kecil", meaning: "Kamu pekerja keras dan selalu bisa diandalkan dalam situasi apa pun." },
        { name: "Cupcake Pelangi", meaning: "Kamu manis dan penuh warna, selalu membawa kebahagiaan dan keceriaan." },
        { name: "Robot Mini", meaning: "Kamu canggih dan selalu siap membantu dengan kecerdasan teknologi tinggi." },
        { name: "Ikan Terbang", meaning: "Kamu unik dan penuh kejutan, selalu melampaui batasan yang ada." },
        { name: "Ayam Goreng", meaning: "Kamu selalu disukai dan dinanti oleh banyak orang, penuh kelezatan dalam setiap langkahmu." },
        { name: "Kecoa Terbang", meaning: "Kamu selalu mengagetkan dan bikin heboh seisi ruangan." },
        { name: "Kambing Ngebor", meaning: "Kamu unik dan selalu bikin orang tertawa dengan tingkah lakumu yang aneh." },
        { name: "Kerupuk Renyah", meaning: "Kamu selalu bikin suasana jadi lebih seru dan nikmat." },
        { name: "Celengan Babi", meaning: "Kamu selalu menyimpan kejutan di dalam dirimu." },
        { name: "Lemari Tua", meaning: "Kamu penuh dengan cerita dan kenangan masa lalu." },
        { name: "Kopi Susu", meaning: "Kamu manis dan selalu bikin semangat orang-orang di sekitarmu." },
        { name: "Sapu Lidi", meaning: "Kamu kuat dan selalu bisa diandalkan untuk membersihkan masalah." },
        { name: "Indomie Goreng", meaning: "Selalu bikin kenyang dan bahagia" },
        { name: "Es Krim Meleleh", meaning: "Selalu mencairkan suasana dengan rasa manisnya" },
        { name: "Bakso Ulet", meaning: "Selalu gigih dan bulat dalam menghadapi masalah" },
        { name: "Lem Super", meaning: "Selalu lengket dalam situasi yang rumit" },
        { name: "Kecap Manis", meaning: "Selalu memberikan sentuhan manis dalam hidup" },
        { name: "Sabun Mandi", meaning: "Selalu bersih dan wangi" },
        { name: "Kopi Tumpah", meaning: "Selalu bersemangat, tapi kadang berantakan" },
        { name: "Kucing Kampung", meaning: "Selalu mandiri dan penuh petualangan" },
        { name: "Jamu Pahit", meaning: "Selalu memberi kekuatan meski tak enak di awal" },
        { name: "Teh Celup", meaning: "Selalu memberikan rasa hangat di hati" },
        { name: "Motor Astrea", meaning: "Selalu setia dan bandel" },
        { name: "Mie Instan", meaning: "Selalu cepat dan mengenyangkan" },
        { name: "Bolu Kukus", meaning: "Selalu lembut dan manis" },
        { name: "Tahu Bulat", meaning: "Selalu enak di segala suasana" },
        { name: "Nasi Uduk", meaning: "Selalu cocok di segala waktu" },
        { name: "Singa Bermahkota", meaning: "Kamu lahir sebagai pemimpin, memiliki kekuatan dan kebijaksanaan seorang raja." },
        { name: "Macan Kumbang", meaning: "Kamu misterius dan kuat, seperti macan yang jarang terlihat tapi selalu waspada." },
        { name: "Kuda Emas", meaning: "Kamu berharga dan kuat, siap untuk berlari menuju kesuksesan." },
        { name: "Elang Biru", meaning: "Kamu memiliki visi yang tajam dan dapat melihat peluang dari jauh." },
        { name: "Naga Pelangi", meaning: "Kamu tangguh dan memiliki kekuatan untuk melindungi dan menyerang." },
        { name: "Gajah Putih", meaning: "Kamu bijaksana dan memiliki kekuatan besar, lambang dari keberanian dan keteguhan hati." },
        { name: "Banteng Sakti", meaning: "Kamu kuat dan penuh semangat, tidak takut menghadapi rintangan." },
        { name: "Kipas Angin", meaning: "Selalu memberikan angin segar" },
        { name: "Rice Cooker", meaning: "Selalu memasak nasi dengan sempurna" },
        { name: "Honda Beat", meaning: "Selalu lincah di jalanan" },
        { name: "Sandal Jepit", meaning: "Selalu santai dan nyaman" },
        { name: "Bantal Guling", meaning: "Selalu nyaman di pelukan" },
        { name: "Anjing Pelacak", meaning: "Kamu setia dan penuh dedikasi, selalu menemukan jalan menuju tujuanmu." }
    ];

    let targetName = m.pushName || m.key.participant?.split('@')[0] || jid.split('@')[0];
    
    if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
        const quotedJid = m.message.extendedTextMessage.contextInfo.participant;
        if (quotedJid) {
            targetName = quotedJid.split('@')[0];
        }
    } else if (q) {
        let cleanQ = q.replace(/@/g, '').trim();
        if (cleanQ) targetName = cleanQ;
    }

    const khodam = KHODAMS[Math.floor(Math.random() * KHODAMS.length)];
    const txt = `Halo kak ${targetName}, Khodam kamu adalah ${khodam.name}. Khodam ini memiliki arti: ${khodam.meaning}`;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const tts = new gtts(txt, 'id');
        const id = Date.now();
        const tempDir = path.join(process.cwd(), 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempPath = path.join(tempDir, `khodam-${id}.mp3`);
        
        tts.save(tempPath, async function (err: any) {
            if (err) {
                console.error("[Cekkhodam Error]:", err);
                await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
                sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                return;
            }
            
            await sock.sendMessage(jid, {
                audio: fs.readFileSync(tempPath),
                mimetype: 'audio/mp4',
                ptt: true,
                contextInfo: {
                    ...getContextInfo(deviceConfig, m),
                    forwardingScore: 9999,
                    isForwarded: true,
                },
                forwardedNewsletterMessageInfo: {
                    newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                    newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                    serverMessageId: 1
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
            
            try {
                fs.unlinkSync(tempPath);
            } catch (error) {
                console.error("Failed to delete temp file", error);
            }
        });
    } catch (err: any) {
        console.error("[Cekkhodam Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function translateHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `🌐 *Tʀᴀɴsʟᴀᴛᴇ*\n\n> Terjemahkan teks ke bahasa Indonesia.\n\n\`Contoh: ${prefix}translate I love you\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    let source = "auto";
    let target = "id";
    let text = q;

    try {
        const { data } = await axios.get(`https://api.siputzx.my.id/api/tools/translate?text=${encodeURIComponent(text)}&source=${source}&target=${target}`);
        
        if (!data?.status || !data?.data?.translatedText) {
           await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
           return sock.sendMessage(jid, { text: `❌ Gagal menerjemahkan teks.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        const translatedText = data.data.translatedText;
        const resultText = `🌐 *Tʀᴀɴsʟᴀᴛᴇ*\n\n*Hasil Terjemahan:*\n${translatedText}`;

        await sock.sendMessage(jid, {
            text: resultText.trim(),
            contextInfo: getContextInfo(deviceConfig, m),
            forwardedNewsletterMessageInfo: {
                newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                serverMessageId: 1
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Translate Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function kalkulatorwrHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q || !q.includes("|")) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}kalkulatormlbb <total_match>|<wr_sekarang>|<wr_target>\`\n\n> Contoh:\n> \`${prefix}kalkulatormlbb 280|79.0|90\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const [total_match, wr_now, wr_target] = q.split("|").map(s => s.trim());

    if (!total_match || !wr_now || !wr_target) {
        return sock.sendMessage(jid, { 
            text: `❌ Harap masukkan format yang benar: <total_match>|<wr_sekarang>|<wr_target>`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const { data } = await axios.get(`https://api.nexray.eu.cc/tools/winrate-mlbb?total_match=${encodeURIComponent(total_match)}&wr_now=${encodeURIComponent(wr_now)}&wr_target=${encodeURIComponent(wr_target)}`);
        
        if (!data?.status || !data?.result) {
           await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
           return sock.sendMessage(jid, { text: `❌ Gagal menghitung winrate.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        const resultText = `📈 *Kᴀʟᴋᴜʟᴀᴛᴏʀ Mʟʙʙ*\n\n> ${data.result}`;

        await sock.sendMessage(jid, {
            text: resultText,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 9999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                    newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                    serverMessageId: 1
                }
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Kalkulator WR Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function emojigifHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}emojigif <emoji>\`\n\n> Contoh:\n> \`${prefix}emojigif 😭\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const response = await axios.get(`https://api.nexray.eu.cc/tools/emojigif?emoji=${encodeURIComponent(q)}`, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        await sock.sendMessage(jid, {
            sticker: buffer,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 9999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                    newsletterName: deviceConfig.bot?.name || 'CMNTY-BOT',
                    serverMessageId: 1
                }
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Emojigif Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function jadwaltvHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}jadwaltv <channel>\`\n\n> Contoh:\n> \`${prefix}jadwaltv mnctv\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const { data } = await axios.get(`https://api.nexray.eu.cc/information/jadwaltv?channel=${encodeURIComponent(q)}`);
        
        if (!data?.status || !data?.result || data.result.length === 0) {
           await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
           return sock.sendMessage(jid, { text: `❌ Jadwal TV untuk channel *${q}* tidak ditemukan.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        let resultText = `📺 *ᴊᴀᴅᴡᴀʟ ᴛᴠ: ${q.toUpperCase()}*\n\n`;
        resultText += `╭┈┈⬡\n`;
        data.result.forEach((item: any) => {
            resultText += `┃ 🕒 *${item.time}* - ${item.program}\n`;
        });
        resultText += `╰┈┈┈┈┈┈┈┈⬡`;

        await sock.sendMessage(jid, {
            text: resultText,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[JadwalTV Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function jadwalbolaHandler(m: any, sock: any, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const { data } = await axios.get(`https://api.nexray.eu.cc/information/jadwalbola`);
        
        if (!data?.status || !data?.result || data.result.length === 0) {
           await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
           return sock.sendMessage(jid, { text: `❌ Jadwal bola tidak tersedia saat ini.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        let resultText = `⚽ *ᴊᴀᴅᴡᴀʟ ꜱᴇᴘᴀᴋ ʙᴏʟᴀ ᴛᴇʀʙᴀʀᴜ*\n\n`;
        resultText += `╭┈┈⬡\n`;
        data.result.slice(0, 30).forEach((match: string) => { // Membatasi agar tidak terlalu panjang
            resultText += `┃ 🏆 ${match}\n`;
        });
        resultText += `╰┈┈┈┈┈┈┈┈⬡`;

        await sock.sendMessage(jid, {
            text: resultText,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[JadwalBola Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function avengersHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q || !q.includes("|")) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}avengers <teks1>|<teks2>\`\n\n> Contoh:\n> \`${prefix}avengers CMNTY|BOT\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    const [t1, t2] = q.split("|").map(t => t.trim());
    if (!t1 || !t2) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}avengers <teks1>|<teks2>\`\n\n> Contoh:\n> \`${prefix}avengers CMNTY|BOT\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/avengers?text1=${encodeURIComponent(t1)}&text2=${encodeURIComponent(t2)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🎬 *ᴀᴠᴇɴɢᴇʀꜱ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks 1:* ${t1}\n> ✨ *Teks 2:* ${t2}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Avengers Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function bearHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}bear <teks>\`\n\n> Contoh:\n> \`${prefix}bear CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/bear?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🐻 *ʙᴇᴀʀ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Bear Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo bear.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function blackpinkHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}blackpink <teks>\`\n\n> Contoh:\n> \`${prefix}blackpink CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/blackpink?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `💖 *ʙʟᴀᴄᴋᴘɪɴᴋ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Blackpink Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo blackpink.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function mascotHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    const [t1, t2, style] = q.split("|");

    const mascotStyles = [
        "ninja-cat", "cobra", "lion-king", "gorilla-2", "flash-wolf", "fire-skull", "eagle-2", "dog", "mask-skull", "team", "pubg", "drift", "bee",
        "rabbit", "pirates", "owl-2", "neon-wolf", "rooster", "rhino", "puma", "phoenix", "panther", "owl", "lion", "horse", "hornet", "griffin",
        "goat", "fox", "eagle", "dragon2", "dragon", "devil", "cobra-2", "bull", "bear", "monkey", "warrior", "skull", "horus", "octopus",
        "rounin", "scorpion", "skull-2", "tiger-3", "wolver", "tiger-2", "tiger", "shark", "sabertooth-3", "horse-2", "husky", "kraken",
        "lynx", "sabertooth", "assassin", "bee-2", "cat-2", "demon", "fox-2", "gorilla", "kitsune", "octopus-2", "piranha", "wolf", "bear-2",
        "cat", "ceberus", "crocodile", "dinosaur", "dragon-3", "eagle-3", "wolf-3", "dragon-5", "jet", "knight", "skull-3", "skull-cyborg",
        "tiger-4", "bee-3", "dragon-4", "fox-3", "goat-2", "demon-cat", "monster", "octopus-3", "panda", "sabertooth-2", "snake", "tiger-5",
        "tiger-6", "wolf-2"
    ];

    if (!t1 || !t2) {
        let helpText = `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}mascot <teks1>|<teks2>|<style>\`\n\n> ✨ *Contoh:*\n> \`${prefix}mascot CMNTY|BOT|cobra\`\n\n🎨 *ᴅᴀꜰᴛᴀʀ sᴛʏʟᴇ:*\n\n`;
        
        // Chunk styles for better readability
        for (let i = 0; i < mascotStyles.length; i += 3) {
            helpText += `   ◦ ${mascotStyles.slice(i, i + 3).join(", ")}\n`;
        }

        return sock.sendMessage(jid, {
            text: helpText,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const selectedStyle = style && mascotStyles.includes(style.trim().toLowerCase()) ? style.trim().toLowerCase() : "ninja-cat";
        const imageUrl = `https://api.nexray.eu.cc/textpro/mascot?text1=${encodeURIComponent(t1)}&text2=${encodeURIComponent(t2)}&style=${encodeURIComponent(selectedStyle)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🎭 *ᴍᴀꜱᴄᴏᴛ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks 1:* ${t1}\n> ✨ *Teks 2:* ${t2}\n> 🎨 *Style:* ${selectedStyle}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Mascot Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo mascot.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function narutoHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}naruto <teks>\`\n\n> Contoh:\n> \`${prefix}naruto CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/naruto?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🍥 *ɴᴀʀᴜᴛᴏ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Naruto Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo naruto.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cecanChinaHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/cecan/china`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🏮 *ᴄᴇᴄᴀɴ ᴄʜɪɴᴀ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar cecan China acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cecan China Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar cecan China.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function papHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/pap`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `📸 *ᴘᴀᴘ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar pap acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Pap Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar pap.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function loliHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/loli`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🍭 *ʟᴏʟɪ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar loli acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Loli Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar loli.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cecanVietnamHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/cecan/vietnam`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🇻🇳 *ᴄᴇᴄᴀɴ ᴠɪᴇᴛɴᴀᴍ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar cecan Vietnam acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cecan Vietnam Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar cecan Vietnam.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cecanThailandHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/cecan/thailand`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🇹🇭 *ᴄᴇᴄᴀɴ ᴛʜᴀɪʟᴀɴᴅ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar cecan Thailand acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cecan Thailand Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar cecan Thailand.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cecanKoreaHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/cecan/korea`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🇰🇷 *ᴄᴇᴄᴀɴ ᴋᴏʀᴇᴀ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar cecan Korea acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cecan Korea Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar cecan Korea.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cecanJapanHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/cecan/japan`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🇯🇵 *ᴄᴇᴄᴀɴ ᴊᴀᴘᴀɴ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar cecan Jepang acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cecan Japan Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar cecan Jepang.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cecanIndoHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/cecan/indonesia`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🇮🇩 *ᴄᴇᴄᴀɴ ɪɴᴅᴏ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar cecan Indonesia acak!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cecan Indo Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar cecan Indonesia.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function blueArchiveHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/ba`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🎓 *ʙʟᴜᴇ ᴀʀᴄʜɪᴠᴇ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Status:* Berhasil mengambil gambar acak Blue Archive!\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Blue Archive Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar Blue Archive.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function animeHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/random/anime?type=waifu`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🌸 *ᴀɴɪᴍᴇ ʀᴀɴᴅᴏᴍ ɪᴍᴀɢᴇ*\n\n> ✨ *Tipe:* waifu\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Anime Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat mengambil gambar anime.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function pornhubHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    const [t1, t2] = q.split("|");

    if (!t1 || !t2) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}pornhub <teks1>|<teks2>\`\n\n> ✨ *Contoh:*\n> \`${prefix}pornhub CMNTY|BOT\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/pornhub?text1=${encodeURIComponent(t1)}&text2=${encodeURIComponent(t2)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🎬 *ᴘᴏʀɴʜᴜʙ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks 1:* ${t1}\n> ✨ *Teks 2:* ${t2}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Pornhub Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo pornhub.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function pixelGlitchHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}pixel-glitch <teks>\`\n\n> Contoh:\n> \`${prefix}pixel-glitch CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/pixel-glitch?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `👾 *ᴘɪxᴇʟ ɢʟɪᴛᴄʜ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Pixel Glitch Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo pixel glitch.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function glitchHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}glitch <teks>\`\n\n> Contoh:\n> \`${prefix}glitch CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/glitch?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `👾 *ɢʟɪᴛᴄʜ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Glitch Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo glitch.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function comicHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}comic <teks>\`\n\n> Contoh:\n> \`${prefix}comic CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/comic?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `💥 *ᴄᴏᴍɪᴄ ʟᴏɢᴏ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Comic Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo comic.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function cartoonGraffitiHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}cartoon-graffiti <teks>\`\n\n> Contoh:\n> \`${prefix}cartoon-graffiti CMNTY\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const imageUrl = `https://api.nexray.eu.cc/textpro/cartoon-graffiti?text=${encodeURIComponent(q)}`;
        
        await sock.sendMessage(jid, {
            image: { url: imageUrl },
            caption: `🎨 *ᴄᴀʀᴛᴏᴏɴ ɢʀᴀꜰꜰɪᴛɪ ᴍᴀᴋᴇʀ*\n\n> ✨ *Teks:* ${q}\n\n🔥 *Selesai!*`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[Cartoon Graffiti Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan saat membuat logo cartoon graffiti.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function trackipHandler(m: any, sock: any, q: string, deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const jid = m.key.remoteJid;
    const prefix = ".";

    if (!q) {
        return sock.sendMessage(jid, {
            text: `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}trackip <target/domain/ip>\`\n\n> Contoh:\n> \`${prefix}trackip google.com\``,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }

    await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

    try {
        const { data } = await axios.get(`https://api.nexray.eu.cc/tools/trackip?target=${encodeURIComponent(q)}`);
        
        if (!data?.status || !data?.result) {
           await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
           return sock.sendMessage(jid, { text: `❌ Gagal mendapatkan informasi IP/Domain.`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        }

        const res = data.result;
        let resultText = `🌐 *Tʀᴀᴄᴋ ɪᴘ*\n\n`;
        resultText += `╭┈┈⬡\n`;
        resultText += `┃ 📌 *IP/Host:* ${res.ip || "-"}\n`;
        resultText += `┃ 🌍 *Negara:* ${res.country || "-"} (${res.country_code || "-"})\n`;
        resultText += `┃ 🏢 *Provinsi:* ${res.region_name || "-"} (${res.region || "-"})\n`;
        resultText += `┃ 🏙️ *Kota:* ${res.city || "-"}\n`;
        resultText += `┃ 📮 *Kode Pos:* ${res.zip || "-"}\n`;
        resultText += `┃ 🕒 *Timezone:* ${res.timezone || "-"}\n`;
        resultText += `┃ 📡 *ISP:* ${res.isp || "-"}\n`;
        resultText += `┃ 🏢 *Org/AS:* ${res.org || "-"} / ${res.as || "-"}\n`;
        resultText += `┃ 🗺️ *Location:* ${res.latitude || "-"}, ${res.longitude || "-"}\n`;
        resultText += `╰┈┈┈┈┈┈┈┈⬡\n`;

        await sock.sendMessage(jid, {
            text: resultText,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 9999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                    newsletterName: deviceConfig.bot?.name || 'CMNTY-BOT',
                    serverMessageId: 1
                }
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        
    } catch (err: any) {
        console.error("[TrackIP Error]:", err.message);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
    }
}

async function ttdown_musical(url: string) {
    const controller = new AbortController();
    const { signal } = controller;

    const custom = async () => {
        const response = await axios.get("https://musicaldown.com/en", {
            headers: {
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            signal,
            timeout: 15000
        });
        const html = response.data;
        const $ = cheerio.load(html);
        const payload: any = {};
        $("#submit-form input").each((i, elem) => {
            const name = $(elem).attr("name");
            const value = $(elem).attr("value");
            if (name) payload[name] = value || "";
        });
        const urlField = Object.keys(payload).find((key) => !payload[key]);
        if (urlField) payload[urlField] = url;
        const setCookie = response.headers["set-cookie"];
        const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie || "";

        const { data } = await axios.post("https://musicaldown.com/download", new URLSearchParams(payload).toString(), {
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                cookie: cookieStr,
                "user-agent": "Mozilla/5.0 (Linux; Android 15; SM-F958 Build/AP3A.240905.015) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.6723.86 Mobile Safari/537.36",
            },
            signal,
            timeout: 15000
        });
        const $$ = cheerio.load(data);
        const videoHeader = $$(".video-header");
        const bgImage = videoHeader.attr("style");
        const coverMatch = bgImage?.match(/url\((.*?)\)/);

        const downloads: any[] = [];
        $$("a.download").each((i, elem) => {
            const $elem = $$(elem);
            const dataEvent = $elem.data("event") as string | undefined;
            const type = dataEvent?.replace("_download_click", "");
            downloads.push({
                type: type,
                url: $elem.attr("href"),
            });
        });
        return {
            title: $$(".video-desc").text().trim() || "TikTok Music",
            author: { 
                username: $$(".video-author b").text().trim() || "-",
                avatar: $$(".img-area img").attr("src") || ""
            },
            cover: coverMatch ? coverMatch[1] : "",
            downloads: downloads,
        };
    };

    const siputzx = async () => {
        const res = await axios.get(`https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`, { signal, timeout: 15000 });
        if (res.data?.status && res.data?.data) {
            const d = res.data.data;
            return {
                title: d.title || "TikTok Music",
                author: { 
                    username: d.author?.nickname || "-",
                    avatar: ""
                },
                cover: "",
                downloads: [{ type: "mp3", url: d.music || d.audio }]
            };
        }
        throw new Error("Siputzx fail");
    };

    const nexray = async () => {
        const res = await axios.get(`https://api.nexray.web.id/downloader/tiktok?url=${encodeURIComponent(url)}`, { signal, timeout: 15000 });
        if (res.data?.status && res.data?.result) {
            const r = res.data.result;
            return {
                title: r.title || "TikTok Music",
                author: { 
                    username: r.author?.name || "-",
                    avatar: ""
                },
                cover: "",
                downloads: [{ type: "mp3", url: r.audio || r.music }]
            };
        }
        throw new Error("NexRay fail");
    };

    try {
        const result = await Promise.any([custom(), siputzx(), nexray()]);
        controller.abort();
        return result;
    } catch (e: any) {
        throw new Error("Gagal mengambil audio TikTok: " + e.message);
    }
}

function formatNumber(num: any) {
  const n = parseInt(num);
  if (isNaN(n)) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

async function to3dMode(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const imageMessage = 
    m.message?.imageMessage || 
    m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage || 
    m.quoted?.imageMessage;

  if (!imageMessage) {
    return sock.sendMessage(
      jid,
      {
        text:
          `🎮 *ᴛᴏ 3ᴅ*\n\n` +
          `> Kirim/reply gambar untuk diubah ke gaya 3D\n\n` +
          `\`${prefix}to3d\``,
        contextInfo: ctx,
      },
      { quoted: getVerifiedQuoted(deviceConfig) as any },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const stream = await downloadContentFromMessage(
      imageMessage,
      "image",
    );
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }


    const PROMPT = `Transform this image into a high-quality 3D rendered style like Pixar or DreamWorks CGI. 
Apply realistic lighting, smooth textures, and that polished 3D animated movie look. 
Keep the original composition but make it look like a frame from a modern 3D animated film 
with subsurface scattering on skin, detailed hair, and cinematic lighting.`;

    const result = await live3d(buffer, PROMPT);

    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { image: result.image, caption: `🎮 *to 3D Render*`, contextInfo: ctx }, { quoted: m });
  } catch (error: any) {
    console.error("[to3d error]:", error);
    await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${error.message}`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function tochibiMode(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const isImage =
    m.isImage ||
    m.message?.imageMessage ||
    (m.quoted && (m.quoted.isImage || m.quoted.type === "imageMessage" || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage));

  if (!isImage) {
    return sock.sendMessage(
      jid,
      {
        text:
          `🎀 *ᴄʜɪʙɪ sᴛʏʟᴇ*\n\n` +
          `> Kirim/reply gambar untuk diubah ke style Chibi\n\n` +
          `\`${prefix}tochibi\``,
        contextInfo: ctx,
      },
      { quoted: getVerifiedQuoted(deviceConfig) as any },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const qMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const isQuotedImage = qMsg && qMsg.imageMessage;
    const msgToDownload = isQuotedImage
      ? {
          key: { remoteJid: jid, id: m.message.extendedTextMessage.contextInfo.stanzaId },
          message: qMsg,
        }
      : m;

    const stream = await downloadContentFromMessage(
      msgToDownload.message.imageMessage || msgToDownload.message.videoMessage || msgToDownload.message.documentMessage,
      "image",
    );
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const PROMPT = `Transform into chibi style, big head and small body proportions, cute expression, big sparkling eyes, smooth shading, soft lighting, highly detailed, high quality`;

    const result = await live3d(buffer, PROMPT);

    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { image: result.image, caption: `🎀 *Chibi Style*`, contextInfo: ctx }, { quoted: m });
  } catch (error: any) {
    console.error("[tochibi error]:", error);
    await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${error.message}`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function susuMode(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const isImage =
    m.isImage ||
    m.message?.imageMessage ||
    (m.quoted && (m.quoted.isImage || m.quoted.type === "imageMessage" || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage));

  if (!isImage) {
    return sock.sendMessage(
      jid,
      {
        text:
          `🥛 *Susu Maker*\n\n` +
          `> Kirim/reply gambar untuk diubah ke kemasan susu\n\n` +
          `*Cara Pakai:*\n` +
          `> 1. Kirim foto + caption \`${prefix}susu\`\n` +
          `> 2. Reply foto dengan \`${prefix}susu\`\n\n` +
          `\`Contoh: ${prefix}susu (sambil reply/kirim gambar)\``,
        contextInfo: ctx
      },
      { quoted: getVerifiedQuoted(deviceConfig) as any }
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const type = Object.keys(m.message || {})[0];
    const isQuoted = type === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const msg = isQuoted ? m.message.extendedTextMessage.contextInfo.quotedMessage : m.message;
    
    let targetMsg = msg;
    if (targetMsg?.viewOnceMessageV2) targetMsg = targetMsg.viewOnceMessageV2.message;
    if (targetMsg?.viewOnceMessage) targetMsg = targetMsg.viewOnceMessage.message;

    const target = targetMsg?.imageMessage;

    if (!target) {
        throw new Error("Gambar tidak ditemukan/tidak valid");
    }

    const stream = await downloadContentFromMessage(target, "image");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const gmbr = await uploadToTmpFiles(buffer, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    const apiUrl = `https://api.cuki.biz.id/api/canvas/susu-original?apikey=cuki-x&image=${encodeURIComponent(gmbr.directUrl)}`;
    
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { image: { url: apiUrl }, caption: `✅ *DONE*`, contextInfo: ctx }, { quoted: m });
  } catch (error: any) {
    console.error("[susu error]:", error);
    await sock.sendMessage(jid, { react: { text: "❌", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Coba lagi. ${error.message}`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function susuTaroMode(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const isImage =
    m.isImage ||
    m.message?.imageMessage ||
    (m.quoted && (m.quoted.isImage || m.quoted.type === "imageMessage" || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage));

  if (!isImage) {
    return sock.sendMessage(
      jid,
      {
        text:
          `🥛 *Susu Taro Maker*\n\n` +
          `> Kirim/reply gambar untuk diubah ke kemasan susu taro\n\n` +
          `*Cara Pakai:*\n` +
          `> 1. Kirim foto + caption \`${prefix}susutaro\`\n` +
          `> 2. Reply foto dengan \`${prefix}susutaro\`\n\n` +
          `\`Contoh: ${prefix}susutaro (sambil reply/kirim gambar)\``,
        contextInfo: ctx
      },
      { quoted: getVerifiedQuoted(deviceConfig) as any }
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const type = Object.keys(m.message || {})[0];
    const isQuoted = type === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage;
    const msg = isQuoted ? m.message.extendedTextMessage.contextInfo.quotedMessage : m.message;
    
    let targetMsg = msg;
    if (targetMsg?.viewOnceMessageV2) targetMsg = targetMsg.viewOnceMessageV2.message;
    if (targetMsg?.viewOnceMessage) targetMsg = targetMsg.viewOnceMessage.message;

    const target = targetMsg?.imageMessage;

    if (!target) {
        throw new Error("Gambar tidak ditemukan/tidak valid");
    }

    const stream = await downloadContentFromMessage(target, "image");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const gmbr = await uploadToTmpFiles(buffer, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    const apiUrl = `https://api.cuki.biz.id/api/canvas/susu-taro?apikey=cuki-x&image=${encodeURIComponent(gmbr.directUrl)}`;
    
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { image: { url: apiUrl }, caption: `✅ *DONE*`, contextInfo: ctx }, { quoted: m });
  } catch (error: any) {
    console.error("[susutaro error]:", error);
    await sock.sendMessage(jid, { react: { text: "❌", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Coba lagi. ${error.message}`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function fakemlMode(m: any, sock: any, q: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const name = q?.trim();
  if (!name) {
    return sock.sendMessage(jid, {
      text: `🎮 *ꜰᴀᴋᴇ ᴍʟ ᴘʀᴏꜰɪʟᴇ*\n\n` +
            `> Masukkan nama untuk profile\n\n` +
            `*ᴄᴀʀᴀ ᴘᴀᴋᴀɪ:*\n` +
            `> 1. Kirim foto + caption \`${prefix}fakeml <nama>\`\n` +
            `> 2. Reply foto dengan \`${prefix}fakeml <nama>\``,
      contextInfo: ctx
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  let buffer: Buffer | null = null;
  const typeMedia = Object.keys(m.message || {})[0];
  const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
  const isImage = !!m.message?.imageMessage;
  
  if (isImage || isQuotedImage) {
      try {
        const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
        const stream = await downloadContentFromMessage(target, "image");
        buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
      } catch (e) {}
  } else {
      try {
        let te = await sock.profilePictureUrl(m.sender, "image");
        buffer = Buffer.from((await axios.get(te, { responseType: "arraybuffer" })).data);
      } catch (error) {}
  }

  if (!buffer) {
    return sock.sendMessage(jid, { text: `❌ Kirim/reply gambar untuk dijadikan avatar!`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const gmbr = await uploadToTmpFiles(buffer, {
      filename: "image.jpg",
      contentType: "image/jpeg",
    });

    const mlUrl = `https://api.nexray.web.id/maker/fakelobyml?avatar=${encodeURIComponent(gmbr.directUrl)}&nickname=${encodeURIComponent(name)}`;
    
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { image: { url: mlUrl }, caption: `✅ *ꜰᴀᴋᴇ ᴍʟ ᴘʀᴏꜰɪʟᴇ*`, contextInfo: ctx }, { quoted: m });
  } catch (error: any) {
    console.error("[fakeml error]:", error);
    await sock.sendMessage(jid, { react: { text: "❌", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Coba lagi`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function toblackMode(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const isImage =
    m.isImage ||
    m.message?.imageMessage ||
    (m.quoted && (m.quoted.isImage || m.quoted.type === "imageMessage" || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage));

  if (!isImage) {
    return sock.sendMessage(
      jid,
      {
        text:
          `🖤 *ʙʟᴀᴄᴋ sᴛʏʟᴇ*\n\n` +
          `> Kirim/reply gambar\n\n` +
          `\`${prefix}toblack\``,
        contextInfo: ctx,
      },
      { quoted: getVerifiedQuoted(deviceConfig) as any },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const qMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const isQuotedImage = qMsg && qMsg.imageMessage;
    const msgToDownload = isQuotedImage
      ? {
          key: { remoteJid: jid, id: m.message.extendedTextMessage.contextInfo.stanzaId },
          message: qMsg,
        }
      : m;

    const stream = await downloadContentFromMessage(
      msgToDownload.message.imageMessage || msgToDownload.message.videoMessage || msgToDownload.message.documentMessage,
      "image",
    );
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const PROMPT = `Transform skin tone to a darker complexion, maintain facial features, realistic shadows, high detail, natural skin texture, no distortion`;

    const result = await live3d(buffer, PROMPT);

    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { image: result.image, caption: `🖤 *Black Style*`, contextInfo: ctx }, { quoted: m });
  } catch (error: any) {
    console.error("[toblack error]:", error);
    await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${error.message}`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}



async function makeSticker(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const type = Object.keys(m.message)[0];
  const isQuoted =
    type === "extendedTextMessage" &&
    m.message.extendedTextMessage.contextInfo.quotedMessage;
  const msg = isQuoted
    ? m.message.extendedTextMessage.contextInfo.quotedMessage
    : m.message;
  
  const mime = (msg.imageMessage || msg.videoMessage || msg.viewOnceMessageV2?.message?.imageMessage || msg.viewOnceMessageV2?.message?.videoMessage)?.mimetype || '';

  const jid = m.key.remoteJid;
  const ctx = getContextInfo(deviceConfig, m);

  if (!/image|video/.test(mime)) {
    return sock.sendMessage(
      jid,
      { text: "✨ *Sᴛɪᴄᴋᴇʀ Mᴀᴋᴇʀ*\n\n> Kirim/balas foto atau video untuk dijadikan stiker\n\n\`Contoh: .s\`\n\n💡 *Tips:* Mendukung gambar statis maupun video singkat untuk stiker animasi.", contextInfo: ctx },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, {
    react: { text: "⏳", key: m.key },
  });

  try {
    const mediaType = mime.split('/')[0];
    const targetMsg = msg.viewOnceMessageV2?.message || msg;
    const stream = await downloadContentFromMessage(
        targetMsg[mediaType + 'Message'],
        mediaType as any
    );
    
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    const sticker = new Sticker(buffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 70,
    });

    const stickerBuffer = await sticker.toBuffer();
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);

  } catch (e: any) {
    console.error(e);
    await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
    sock.sendMessage(jid, { text: `Gagal membuat stiker: ${e.message}`, contextInfo: ctx }, { quoted: m });
  }
}

async function stickerToImage(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const type = Object.keys(m.message)[0];
  const isQuoted =
    type === "extendedTextMessage" &&
    m.message.extendedTextMessage.contextInfo.quotedMessage;
  const msg = isQuoted
    ? m.message.extendedTextMessage.contextInfo.quotedMessage
    : m.message;
  
  const stickerMsg = msg.stickerMessage;

  if (!stickerMsg) {
    return sock.sendMessage(
      m.key.remoteJid,
      { text: "🖼️ *Sᴛɪᴄᴋᴇʀ ᴛᴏ Iᴍᴀɢᴇ*\n\n> Balas stiker untuk mengubahnya menjadi gambar biasa\n\n\`Contoh: .toimg\`\n\n💡 *Tips:* Hanya bekerja pada stiker statis (bukan animasi)." },
      { quoted: m },
    );
  }

  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (stickerMsg.isAnimated) {
    return sock.sendMessage(
        jid,
        { text: `⚠️ *sᴛɪᴄᴋᴇʀ ᴀɴɪᴍᴀsɪ*\n\n> Sticker ini adalah sticker animasi (GIF).\n> Gunakan *.tovideo* (jika tersedia) untuk mengubahnya.`, contextInfo: ctx },
        { quoted: m }
    );
  }

  await sock.sendMessage(jid, {
    react: { text: "🕕", key: m.key },
  });

  try {
    const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    if (!buffer || buffer.length === 0) {
        throw new Error("Gagal mengunduh sticker.");
    }

    // Convert webp to jpeg
    const imageBuffer = await sharp(buffer)
        .toFormat('jpeg')
        .toBuffer();

    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
    await sock.sendMessage(jid, {
        image: imageBuffer,
        caption: `✅ *ʙᴇʀʜᴀsɪʟ*\n\n> Sticker berhasil diubah menjadi gambar!`,
        contextInfo: ctx
    }, { quoted: m });

  } catch (e: any) {
    console.error("[ToImg Error]:", e.message);
    await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
    sock.sendMessage(jid, { text: `❌ *ᴇʀʀᴏʀ*\n\n> Gagal mengubah sticker: ${e.message}`, contextInfo: ctx }, { quoted: m });
  }
}

async function readViewOnce(m: any, sock: any, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  const reply = async (text: string) => {
    return await sock.sendMessage(jid, { text, contextInfo: ctx }, { quoted: m });
  };

  const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  if (!quoted) return reply('🔓 *Rᴇᴀᴅ Vɪᴇᴡ Oɴᴄᴇ*\n\n> Balas pesan (foto/video/suara) yang dikirim sebagai "Sekali Lihat"\n\n\`Contoh: .rvo\`\n\n💡 *Tips:* Bot akan mengirimkan kembali media tersebut agar dapat disimpan.');

  const type = getContentType(quoted);
  const viewOnceContent = type === 'viewOnceMessageV2' ? quoted.viewOnceMessageV2.message : 
                          type === 'viewOnceMessage' ? quoted.viewOnceMessage.message :
                          quoted;
  
  const actualType = getContentType(viewOnceContent);
  const isViewOnce = viewOnceContent?.[actualType]?.viewOnce;

  if (!isViewOnce && type !== 'viewOnceMessageV2' && type !== 'viewOnceMessage') {
      return reply('❌ *Pesan yang kamu reply bukan Sekali Lihat!*');
  }

  await sock.sendMessage(jid, { react: { text: "👁️", key: m.key } });

  try {
      const mediaType = getContentType(viewOnceContent);
      await sock.sendMessage(jid, { react: { text: "☁️", key: m.key } });

      const buffer = await downloadMediaMessage(
          { 
            key: m.key, 
            message: viewOnceContent 
          } as any,
          'buffer',
          {},
          {
              logger: pino({ level: 'silent' }),
              reuploadRequest: sock.updateMediaMessage,
          }
      );

      if (!buffer) throw new Error("Media tidak ditemukan");

      await sock.sendMessage(jid, { react: { text: "⚡", key: m.key } });

      const caption = viewOnceContent[mediaType]?.caption || '';
      const mediaName = {
          'imageMessage': 'FOTO',
          'videoMessage': 'VIDEO',
          'audioMessage': 'VOICE NOTE'
      }[mediaType] || 'MEDIA';

      const footer = `\n\n*🔓 VIEW ONCE BYPASSED*\n_Berhasil membuka ${mediaName}_`;

      if (mediaType === 'imageMessage') {
          await sock.sendMessage(jid, { 
              image: buffer, 
              caption: `╔══════════════════╗\n║  📥  *VIEW ONCE IMAGE* \n╚══════════════════╝\n\n📝 *Caption:* ${caption || '-'}${footer}`,
              contextInfo: ctx
          }, { quoted: m });
      } 
      else if (mediaType === 'videoMessage') {
          await sock.sendMessage(jid, { 
              video: buffer, 
              caption: `╔══════════════════╗\n║  📥  *VIEW ONCE VIDEO* \n╚══════════════════╝\n\n📝 *Caption:* ${caption || '-'}${footer}`,
              contextInfo: ctx
          }, { quoted: m });
      } 
      else if (mediaType === 'audioMessage') {
          await sock.sendMessage(jid, { 
              audio: buffer, 
              mimetype: 'audio/ogg; codecs=opus', 
              ptt: true,
              contextInfo: ctx
          }, { quoted: m });
          
          await sock.sendMessage(jid, { 
              text: `╔══════════════════╗\n║  📥  *VIEW ONCE AUDIO* \n╚══════════════════╝\n\n✅ *VN Berhasil Dibuka*${footer}`,
              contextInfo: ctx
          }, { quoted: m });
      }

      await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });

  } catch (e: any) {
      console.error("[RVO Error]:", e.message);
      await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
      reply(`❌ *Gagal!* Media mungkin sudah dibuka atau kadaluarsa. (${e.message})`);
  }
}

async function smeme(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const type = Object.keys(m.message)[0];
  const isQuoted =
    type === "extendedTextMessage" &&
    m.message.extendedTextMessage.contextInfo.quotedMessage;
  const msg = isQuoted
    ? m.message.extendedTextMessage.contextInfo.quotedMessage
    : m.message;
  
  let targetMsg = msg;
  if (targetMsg.viewOnceMessageV2) targetMsg = targetMsg.viewOnceMessageV2.message;
  if (targetMsg.viewOnceMessage) targetMsg = targetMsg.viewOnceMessage.message;

  const mime = (targetMsg.imageMessage || targetMsg.stickerMessage)?.mimetype || "";

  if (!/image|sticker/.test(mime)) {
    return sock.sendMessage(
      m.key.remoteJid,
      { text: "Reply atau kirim gambar/sticker dengan caption *.smeme Top|Bottom*" },
      { quoted: m },
    );
  }

  if (!text || !text.includes("|")) {
    return sock.sendMessage(
      m.key.remoteJid,
      { text: "🎭 *Mᴇᴍᴇ Sᴛɪᴄᴋᴇʀ*\n\n> Balas foto dengan menambahkan teks atas dan bawah yang dipisahkan tanda |\n\n\`Contoh: .smeme Teks Atas | Teks Bawah\`\n\n💡 *Tips:* Balas foto atau kirim foto dengan format di atas." },
      { quoted: m },
    );
  }

  const [top, bottom] = text.split("|").map((s) => s.trim());
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  await sock.sendMessage(jid, {
    react: { text: "🕕", key: m.key },
  });

  try {
    const mediaType = mime.split("/")[0] === "image" ? "image" : "sticker";
    const stream = await downloadContentFromMessage(
      targetMsg[mediaType + "Message"],
      mediaType as any,
    );

    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    let imageBuffer;
    try {
      imageBuffer = await sharp(buffer)
        .resize(512, 512, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
    } catch (e) {
      imageBuffer = buffer;
    }

    const form = new FormData();
    form.append("file", imageBuffer, {
      filename: "meme.png",
      contentType: "image/png",
    });

    let imageUrl;
    try {
      const uploadRes = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
        headers: form.getHeaders(),
        timeout: 30000,
      });
      if (uploadRes.data?.data?.url) {
        imageUrl = uploadRes.data.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
      }
    } catch (e) {
      // fallback
    }

    if (!imageUrl) {
      throw new Error("Gagal mengunggah gambar untuk meme");
    }

    const encodeText = (t: string) => {
      if (!t) return "_";
      return encodeURIComponent(t)
        .replace(/-/g, "--")
        .replace(/_/g, "__")
        .replace(/%20/g, "_");
    };

    const topEncoded = encodeText(top);
    const bottomEncoded = encodeText(bottom);
    const memeUrl = `https://api.memegen.link/images/custom/${topEncoded}/${bottomEncoded}.png?background=${encodeURIComponent(imageUrl)}`;

    const response = await axios.get(memeUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    if (response.status !== 200 || !response.data) {
        throw new Error(`API returned ${response.status}`);
    }
    const resultBuffer = Buffer.from(response.data);

    const sticker = new Sticker(resultBuffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 70,
    });

    const stickerBuffer = await sticker.toBuffer();

    await sock.sendMessage(jid, {
      react: { text: "✅", key: m.key },
    });

    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    console.error("[Smeme Error]:", error.message);
    if (axios.isAxiosError(error)) {
      console.error("Status:", error.response?.status);
      console.error("Data:", error.response?.data?.toString());
    }
    await sock.sendMessage(jid, {
      react: { text: "☢", key: m.key },
    });
    sock.sendMessage(
      jid,
      { text: `Gagal membuat smeme: ${error.message}`, contextInfo: ctx },
      { quoted: m },
    );
  }
}

async function attpMode(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const jid = m.key.remoteJid;
  const prefix = ".";

  if (!text) {
    return sock.sendMessage(jid, {
      text:
        `🎨 *ᴀɴɪᴍᴀᴛᴇᴅ ᴛᴇxᴛ sᴛɪᴄᴋᴇʀ*\n\n` +
        `> Masukkan teks untuk sticker\n\n` +
        `> Contoh: \`${prefix}attp Hello World\``,
      contextInfo: getContextInfo(deviceConfig, m)
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const apiUrl = `https://api.deline.web.id/maker/attp?text=${encodeURIComponent(text)}`;
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const buffer = Buffer.from(response.data);

    await sendSticker(sock, jid, buffer, m, deviceConfig);
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
  } catch (error: any) {
    console.error("[ATTP Error]:", error);
    await sock.sendMessage(jid, { react: { text: "❌", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { 
      text: `❌ Gagal membuat sticker: ${error.message}`,
      contextInfo: getContextInfo(deviceConfig, m)
    }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function donateTako(m: any, sock: any, q: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const jid = m.key.remoteJid;
  const prefix = "."; 
  
  if (!q || !q.includes("|")) {
      return sock.sendMessage(jid, { 
          text: `💰 *Tᴀᴋᴏ\u200B.id*\n\n> Gunakan format: ${prefix}tako <amount>|<message>\n\n\`Contoh: ${prefix}tako 1000|semangat atmin\``,
          contextInfo: getContextInfo(deviceConfig, m)
      }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  const [amountStr, message] = q.split("|").map(s => s.trim());
  const amount = parseInt(amountStr.replace(/[^0-9]/g, ''));
  
  if (isNaN(amount) || amount < 1000) {
      return sock.sendMessage(jid, { 
          text: `❌ *Input nominal tanpa titik (contoh: 1000). Minimal donasi Rp 1.000, tidak boleh kurang dari 1.000!*`,
          contextInfo: getContextInfo(deviceConfig, m)
      }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

  try {
      const apikey = config.neoxrApiKey || 'CMNTY-BOT';
      const username = config.takoUsername || 'ojicmnty';
      const urlTako = `https://api.neoxr.eu/api/tako-create?username=${username}&amount=${amount}&message=${encodeURIComponent(message)}&apikey=${apikey}`;
      const res = await axios.get(urlTako, { 
          timeout: 30000,
          headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://neoxr.eu/',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept': 'application/json,text/plain,*/*'
          }
      });
      
      const { status, data, msg } = res.data;
      if (!status || !data) throw new Error(msg || "Gagal membuat payment.");

      await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
      
      if (data.qr_image) {
          const base64Data = data.qr_image.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, 'base64');
          await sock.sendMessage(jid, {
              image: buffer,
              caption: `✅ *Tako Payment Created*\n\n> Amount Rp: ${amount.toLocaleString('id-ID')}\n> Pesan: ${message}\n\n> Link: ${data.url}\n\nSilakan bayar menggunakan QR atau link tersebut.`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
      } else {
          await sock.sendMessage(jid, {
              text: `✅ *Tako Payment Created*\n\n> Amount Rp: ${amount.toLocaleString('id-ID')}\n> Pesan: ${message}\n\n> Link: ${data.url}\n\nSilakan bayar menggunakan QR atau link tersebut.`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
      }
  } catch (err: any) {
      console.error("[Donate Tako Error]:", err.response?.data || err.message);
      await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
      sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.response?.data?.message || err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function donateSaweria(m: any, sock: any, q: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const jid = m.key.remoteJid;
  const prefix = "."; 
  
  if (!q || !q.includes("|")) {
      return sock.sendMessage(jid, { 
          text: `💰 *Sᴀᴡᴇʀɪᴀ\u200B.co*\n\n> Gunakan format: ${prefix}saweria <amount>|<message>\n\n\`Contoh: ${prefix}saweria 1000|req fitur baru min\``,
          contextInfo: getContextInfo(deviceConfig, m)
      }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  const [amountStr, message] = q.split("|").map(s => s.trim());
  const amount = parseInt(amountStr.replace(/[^0-9]/g, ''));
  
  if (isNaN(amount) || amount < 1000) {
      return sock.sendMessage(jid, { 
          text: `❌ *Input nominal tanpa titik (contoh: 1000). Minimal donasi Rp 1.000, tidak boleh kurang dari 1.000!*`,
          contextInfo: getContextInfo(deviceConfig, m)
      }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }

  await sock.sendMessage(jid, { react: { text: "⏳", key: m.key } });

  try {
      const apikey = config.neoxrApiKey || 'CMNTY-BOT';
      const userid = config.saweriaUserId || '73182004-b86b-4c16-ace4-bc23c3d8e9aa';
      const urlSaweria = `https://api.neoxr.eu/api/saweria-create?userid=${userid}&amount=${amount}&message=${encodeURIComponent(message)}&apikey=${apikey}`;
      const res = await axios.get(urlSaweria, { 
          timeout: 30000,
          headers: { 
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://neoxr.eu/',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept': 'application/json,text/plain,*/*'
          }
      });
      
      const { status, data, msg } = res.data;
      if (!status || !data) throw new Error(msg || "Gagal membuat payment.");

      await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
      
      if (data.qr_image) {
          const base64Data = data.qr_image.replace(/^data:image\/\w+;base64,/, "");
          const buffer = Buffer.from(base64Data, 'base64');
          await sock.sendMessage(jid, {
              image: buffer,
              caption: `✅ *Saweria Payment Created*\n\n> Amount Rp: ${data.amount_raw.toLocaleString('id-ID')}\n> Pesan: ${data.message}\n\n> Link: ${data.url}\n\nSilakan bayar menggunakan QR atau link tersebut.`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
      } else {
          await sock.sendMessage(jid, {
              text: `✅ *Saweria Payment Created*\n\n> Amount Rp: ${data.amount_raw.toLocaleString('id-ID')}\n> Pesan: ${data.message}\n\n> Link: ${data.url}\n\nSilakan bayar menggunakan QR atau link tersebut.`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
      }
  } catch (err: any) {
      console.error("[Donate Saweria Error]:", err.response?.data || err.message);
      await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
      sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${err.response?.data?.message || err.message}`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function bratVideoSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🎬 *ʙʀᴀᴛ ᴀɴɪᴍᴀᴛᴇᴅ*\n\n> Masukkan teks\n\n\`Contoh: .bratvid Hai semua\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } });

  try {
    const buffer = await axios.get(`https://api.nexray.eu.cc/maker/bratvid?text=${encodeURIComponent(text)}`, { 
      responseType: "arraybuffer", 
      timeout: 30000 
    }).then(res => Buffer.from(res.data));

    const sticker = new Sticker(buffer!, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 70,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[BratVideo Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
      sock.sendMessage(jid, {
          text: `❌ Terjadi kesalahan saat membuat stiker brat animated. Semua server sedang sibuk.`,
          contextInfo: ctx
      }, { quoted: m }).catch(() => {});
    }
  }
}


async function bratStickerVermeil(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: "🟩 *Bʀᴀᴛ Vᴇʀᴍᴇɪʟ Sᴛɪᴄᴋᴇʀ*\n\n> Masukkan teks untuk membuat stiker brat (Vermeil)\n\n\`Contoh: .bratvermeil Hai vermeil\`",
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } });

  try {
    const apiUrl = `https://api.cuki.biz.id/api/canvas/brat/bratnime-vermeil?apikey=cuki-x&text=${encodeURIComponent(text)}`;
    const res = await axios.get(apiUrl, { responseType: "arraybuffer", timeout: 30000 });
    
    if (res.status !== 200) throw new Error("API failed");
    
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer!, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[BratVermeil Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
      return sock.sendMessage(jid, {
          text: `Gagal membuat sticker brat vermeil.`,
          contextInfo: ctx
      }, { quoted: m }).catch(() => {});
    }
  }
}

async function bratAnimeSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: "🟩 *Bʀᴀᴛ Aɴɪᴍᴇ Sᴛɪᴄᴋᴇʀ*\n\n> Masukkan teks untuk membuat stiker brat anime\n\n\`Contoh: .bratanime emang dongo ni orang\`",
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } });

  try {
    const apiUrl = `https://api.nexray.eu.cc/maker/bratanime?text=${encodeURIComponent(text)}`;
    const res = await axios.get(apiUrl, { responseType: "arraybuffer", timeout: 30000 });
    
    if (res.status !== 200) throw new Error("API failed");
    
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer!, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[BratAnime Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
      return sock.sendMessage(jid, {
          text: `Gagal membuat sticker brat anime.`,
          contextInfo: ctx
      }, { quoted: m }).catch(() => {});
    }
  }
}

const DEFAULT_PP = 'https://files.catbox.moe/nwvkbt.png';

const COLORS: { [key: string]: string } = {
    pink: '#f68ac9',
    blue: '#6cace4',
    red: '#f44336',
    green: '#4caf50',
    yellow: '#ffeb3b',
    purple: '#9c27b0',
    darkblue: '#0d47a1',
    lightblue: '#03a9f4',
    ash: '#9e9e9e',
    orange: '#ff9800',
    black: '#000000',
    white: '#ffffff',
    teal: '#008080',
    lightpink: '#FFC0CB',
    chocolate: '#A52A2A',
    salmon: '#FFA07A',
    magenta: '#FF00FF',
    tan: '#D2B48C',
    wheat: '#F5DEB3',
    deeppink: '#FF1493',
    fire: '#B22222',
    skyblue: '#00BFFF',
    brightskyblue: '#1E90FF',
    hotpink: '#FF69B4',
    lightskyblue: '#87CEEB',
    seagreen: '#20B2AA',
    darkred: '#8B0000',
    orangered: '#FF4500',
    cyan: '#48D1CC',
    violet: '#BA55D3',
    mossgreen: '#00FF7F',
    darkgreen: '#008000',
    navyblue: '#191970',
    darkorange: '#FF8C00',
    darkpurple: '#9400D3',
    fuchsia: '#FF00FF',
    darkmagenta: '#8B008B',
    darkgray: '#2F4F4F',
    peachpuff: '#FFDAB9',
    darkishgreen: '#BDB76B',
    darkishred: '#DC143C',
    goldenrod: '#DAA520',
    darkishgray: '#696969',
    darkishpurple: '#483D8B',
    gold: '#FFD700',
    silver: '#C0C0C0',
    maroon: '#800000',
    olive: '#808000',
    lime: '#00FF00',
    indigo: '#4B0082',
    turquoise: '#40E0D0',
    lavender: '#E6E6FA',
    beige: '#F5F5DC',
    crimson: '#DC143C',
    khaki: '#F0E68C',
    plum: '#DDA0DD',
    orchid: '#DA70D6'
};

async function getProfilePicture(sock: any, jid: string) {
    try {
        return await sock.profilePictureUrl(jid, 'image');
    } catch {
        return DEFAULT_PP;
    }
}

async function qcSticker(m: any, sock: any, args: string[], deviceId: string) {
    const instance = getInstance(deviceId);
    const deviceConfig = instance.config;
    const ctx = getContextInfo(deviceConfig, m);
    const jid = m.key.remoteJid;
    const prefix = "."; // prefix default di server.ts

    if (args.length < 1) {
        const colorList = Object.keys(COLORS).join(', ');
        return sock.sendMessage(jid, {
            text: `💬 *ǫᴜᴏᴛᴇ sᴛɪᴄᴋᴇʀ*\n\n` +
            `╭┈┈⬡「 📋 *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ* 」\n` +
            `┃ ◦ \`${prefix}qc <warna> <text>\`\n` +
            `┃ ◦ Reply pesan + \`${prefix}qc <warna>\`\n` +
            `╰┈┈⬡\n\n` +
            `> Contoh: \`${prefix}qc pink Hai semuanya!\`\n\n` +
            `╭┈┈⬡「 🎨 *ᴡᴀʀɴᴀ* 」\n` +
            `┃ ${colorList}\n` +
            `╰┈┈⬡`,
            contextInfo: ctx
        }, { quoted: m });
    }
    
    const color = args[0].toLowerCase();
    const backgroundColor = COLORS[color];
    
    if (!backgroundColor) {
        return sock.sendMessage(jid, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n> Warna \`${color}\` tidak ditemukan!\n> Gunakan salah satu warna yang tersedia.`,
            contextInfo: ctx
        }, { quoted: m });
    }
    
    let message = args.slice(1).join(' ');
    if (m.quoted && !message) {
        message = m.quoted.text || m.quoted.body || m.quoted.caption || '';
    }
    
    if (!message) {
        return sock.sendMessage(jid, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n> Masukkan text untuk quote!`,
            contextInfo: ctx
        }, { quoted: m });
    }
    
    if (message.length > 200) {
        return sock.sendMessage(jid, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n> Maksimal 200 karakter! (Saat ini: ${message.length})`,
            contextInfo: ctx
        }, { quoted: m });
    }
    
    await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } });
    
    try {
        const username = m.pushName || 'User';
        const avatar = 'https://files.catbox.moe/nwvkbt.png';
        
        const json = {
            "messages": [
                {
                    "from": {
                        "id": Math.floor(Math.random() * 10),
                        "first_name": username,
                        "last_name": "",
                        "name": username,
                        "photo": {
                            "url": avatar
                        }
                    },
                    "text": message,
                    "entities": [],
                    "avatar": true,
                    "media": {
                        "url": ""
                    },
                    "mediaType": "",
                    "replyMessage": {}
                }
            ],
            "backgroundColor": backgroundColor,
            "width": 512,
            "height": 512,
            "scale": 2,
            "type": "quote",
            "format": "png",
            "emojiStyle": "apple"
        };
        
        const response = await axios.post('https://brat.siputzx.my.id/quoted', json, {
            timeout: 60000,
            responseType: 'arraybuffer'
        });
        
        const buffer = Buffer.from(response.data);
        
        const sticker = new Sticker(buffer, {
            pack: deviceConfig.stickerPack || "Cmnty Universe",
            author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
            type: StickerTypes.FULL,
            id: "QC-" + Date.now(),
            quality: 100,
        });

        const stickerBuffer = await sticker.toBuffer();
        await sock.sendMessage(jid, { react: { text: "✅", key: m.key } });
        await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
        
    } catch (error: any) {
        console.error(error);
        await sock.sendMessage(jid, { react: { text: "❌", key: m.key } });
        sock.sendMessage(jid, {
            text: `❌ *ᴇʀʀᴏʀ*\n\n> ${error.message}`,
            contextInfo: ctx
        }, { quoted: m });
    }
}

async function bratSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: "🟩 *Bʀᴀᴛ Sᴛɪᴄᴋᴇʀ*\n\n> Masukkan teks untuk membuat stiker brat\n\n\`Contoh: .brat ini teks brat\`",
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } });

  try {
    const fetchBrat = async (url: string) => {
       const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
       if (res.status === 200) return Buffer.from(res.data);
       throw new Error("Failed");
    };

    const buffer = await Promise.any([
        fetchBrat(`https://api.siputzx.my.id/api/m/brat?text=${encodeURIComponent(text)}`),
        fetchBrat(`https://api.zenzxz.my.id/maker/brat?text=${encodeURIComponent(text)}`),
        fetchBrat(`https://api.nexray.web.id/maker/brat?text=${encodeURIComponent(text)}`)
    ]);

    const sticker = new Sticker(buffer!, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
      return sock.sendMessage(jid, {
          text: `Gagal membuat sticker brat. Semua server sedang sibuk.`,
          contextInfo: ctx
      }, { quoted: m }).catch(() => {});
    }
  }
}

async function bratBahlilSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🖼️ *BRAT BAHLIL*\n\n> Masukkan teks\n\n\`Contoh: .bratbahlil manusia nikel\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const url = `https://api.ourin.my.id/api/bratbahlil?text=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Bahlil Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function swmSticker(m: any, sock: any, input: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const jid = m.key.remoteJid;
  const qMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
  const prefix = "."; // Fallback

  if (!qMsg?.stickerMessage) {
    return sock.sendMessage(jid, {
      text: `🖼️ *sᴛɪᴄᴋᴇʀ ᴡᴀᴛᴇʀᴍᴀʀᴋ*\n\n` +
            `> Reply sticker dengan caption:\n` +
            `> \`${prefix}swm Cmnty Universe\`\n\n` +
            `*ᴄᴏɴᴛᴏʜ:*\n` +
            `> \`${prefix}swm Cmnty Universe\`\n` +
            `> \`${prefix}swm Cmnty Universe|jadi-bot.cmnty.web.id\` _(packname + author)_`,
      contextInfo: getContextInfo(deviceConfig, m)
    }, { quoted: m });
  }

  if (!input) {
    return sock.sendMessage(jid, {
      text: `❌ *ɢᴀɢᴀʟ*\n\n` +
            `> Masukkan packname\n\n` +
            `*ᴄᴏɴᴛᴏʜ:*\n` +
            `> \`${prefix}swm Cmnty Universe\`\n` +
            `> \`${prefix}swm Cmnty Universe|jadi-bot.cmnty.web.id\` _(+ author)_`,
      contextInfo: getContextInfo(deviceConfig, m)
    }, { quoted: m });
  }

  let packname, author;
  if (input.includes('|')) {
    const parts = input.split('|');
    packname = parts[0]?.trim() || '';
    author = parts[1]?.trim() || '';
  } else {
    packname = input;
    author = '';
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const stream = await downloadContentFromMessage(qMsg.stickerMessage, "sticker");
    let buffer = Buffer.alloc(0);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }

    if (!buffer || buffer.length === 0) throw new Error("Gagal mengunduh sticker");

    const exifOpts = { packname, author, emojis: ['🤖'] };
    const stickerBuffer = await addExifToWebp(buffer, exifOpts);
    
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);

  } catch (error: any) {
    console.error("[SWM Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function bratVidSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🎬 *ʙʀᴀᴛ ᴀɴɪᴍᴀᴛᴇᴅ*\n\n> Masukkan teks\n\n\`Contoh: .bratvid2 Hai semua\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const tempFile = path.join(os.tmpdir(), `brat-${Date.now()}.mp4`);
    const result = await bratVid(text, {
      outputFormat: 'mp4',
    });
    
    await fs.promises.writeFile(tempFile, result as any);
    
    // In this bot, we have Sticker class. We should use it or send as video if Sticker class doesn't support mp4/animated webp well.
    // However, the request specifically asked for sock.sendVideoAsSticker which might be a custom function in user's environment.
    // In our environment server.ts, we use Sticker class for webp. For animated, we might need to convert or use existing methods.
    
    // I'll check if sendVideoAsSticker exists in our sock or if I should implement a similar logic.
    // Looking at previous turns, we used 'new Sticker' then 'sticker.toBuffer()'.
    
    const sticker = new Sticker(tempFile, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);

    await fs.promises.unlink(tempFile).catch(() => {});
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Animated Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

class StickerAPI {
  async search(query: string, page = 1) {
    try {
      if (!query) throw new Error("Query kosong");
      const res = await axios
        .post("https://getstickerpack.com/api/v1/stickerdb/search", {
          query,
          page,
        })
        .then((r) => r.data);
      const data = res.data.map((item: any) => ({
        name: item.title,
        slug: item.slug,
        url: `https://getstickerpack.com/stickers/${item.slug}`,
        image: `https://s3.getstickerpack.com/${item.cover_image || item.tray_icon_large}`,
        download: item.download_counter,
      }));
      return { status: true, data, total: res.meta.total };
    } catch (e: any) {
      return { status: false, msg: e.message };
    }
  }

  async detail(slug: string) {
    try {
      const match = slug.match(/stickers\/([a-zA-Z0-9-]+)$/);
      const id = match ? match[1] : slug;
      const res = await axios
        .get(`https://getstickerpack.com/api/v1/stickerdb/stickers/${id}`)
        .then((r) => r.data.data);
      const stickers = res.images.map((item: any) => ({
        index: item.sticker_index,
        image: `https://s3.getstickerpack.com/${item.url}`,
        animated: item.is_animated !== 0,
      }));
      return { status: true, title: res.title, stickers };
    } catch (e: any) {
      return { status: false, msg: e.message };
    }
  }
}

async function pinpackMode(m: any, sock: any, q: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;
  const prefix = ".";

  const query = q?.trim();

  if (!query) {
    return sock.sendMessage(
      jid,
      {
        text: `── .✦ 𝗣𝗜𝗡 𝗣𝗔𝗖𝗞 ✦. ── 𝜗ৎ\n\n` +
          `Cari gambar Pinterest → jadikan sticker pack!\n\n` +
          `╭─〔 Cara Pakai 〕───⬣\n` +
          `│  ✦ ${prefix}pinpack <query>\n` +
          `╰──────────────⬣\n\n` +
          `*${prefix}pinpack anime cat*\n` +
          `*${prefix}pinpack aesthetic*\n\n` +
          `.☘︎ ݁˖`,
        contextInfo: ctx
      },
      { quoted: getVerifiedQuoted(deviceConfig) as any }
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const res = await axios.get(`https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(query)}`);
    const results = res.data?.data?.slice(0, 20);

    if (!results || results.length === 0) {
      await sock.sendMessage(jid, { react: { text: "✘", key: m.key } }).catch(() => {});
      return sock.sendMessage(jid, { text: `── .✦ ──\n\n> Tidak ditemukan hasil untuk: *${query}* .☘︎ ݁˖`, contextInfo: ctx }, { quoted: m });
    }

    await sock.sendMessage(jid, {
      text: `── .✦ ──\n\n> Mengunduh *${results.length}* gambar dari Pinterest\n> Lalu dikonversi ke sticker... .☘︎ ݁˖`,
      contextInfo: ctx
    }, { quoted: m });

    const packname = `Pinterest: ${query}`;
    const author = deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id";

    let sent = 0;
    for (const item of results) {
      const imageUrl = item.image_url;
      if (!imageUrl) continue;

      try {
        const imgRes = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
        const buf = Buffer.from(imgRes.data);
        
        const webpBuffer = await sharp(buf)
          .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .webp({ quality: 80 })
          .toBuffer();
          
        const exifBuf = await addExifToWebp(webpBuffer, {
          packname,
          author,
          emojis: ["❤"],
        });

        await sendSticker(sock, jid, exifBuf, m, deviceConfig);
        sent++;
        
        await new Promise(r => setTimeout(r, 700));
      } catch (e) {
        continue;
      }
    }

    if (sent > 0) {
      await sock.sendMessage(jid, { react: { text: "✓", key: m.key } }).catch(() => {});
      await sock.sendMessage(jid, { text: `── .✦ ──\n\n> Berhasil kirim *${sent}* sticker dari *${packname}* .☘︎ ݁˖`, contextInfo: ctx }, { quoted: m });
    } else {
      await sock.sendMessage(jid, { react: { text: "✘", key: m.key } }).catch(() => {});
      await sock.sendMessage(jid, { text: `── .✦ ──\n\n> Gagal mengirim sticker .☘︎ ݁˖`, contextInfo: ctx }, { quoted: m });
    }
  } catch (error: any) {
    console.error("[PinPack Error]:", error.message);
    await sock.sendMessage(jid, { react: { text: "✘", key: m.key } }).catch(() => {});
    await sock.sendMessage(jid, { text: `❌ Terjadi kesalahan: ${error.message}`, contextInfo: ctx }, { quoted: getVerifiedQuoted(deviceConfig) as any });
  }
}

async function stickerPackHandler(m: any, sock: any, query: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!query) {
    return sock.sendMessage(
      jid,
      {
        text: `── .✦ 𝗦𝗧𝗜𝗖Ｋ𝗘𝗥 𝗣𝗔𝗖𝗞 ✦. ── 𝜗ৎ\n\n` +
          `Cari dan kirim sticker pack!\n\n` +
          `╭─〔 Cara Pakai 〕───⬣\n` +
          `│  ✦ .stickerpack <query>\n` +
          `╰──────────────⬣\n\n` +
          `*.stickerpack anime*\n` +
          `*.stickerpack cat*\n\n` +
          `.☘︎ ݁˖`,
        contextInfo: ctx
      },
      { quoted: m }
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const api = new StickerAPI();
    const search = await api.search(query);

    if (!search.status || !search.data?.length) {
      await sock.sendMessage(jid, { react: { text: "✘", key: m.key } }).catch(() => {});
      return sock.sendMessage(jid, { text: `── .✦ ──\n\n> Tidak ada sticker pack untuk: *${query}* .☘︎ ݁˖`, contextInfo: ctx }, { quoted: m });
    }

    const randPick = search.data[Math.floor(Math.random() * search.data.length)];
    const detail = await api.detail(randPick.url);

    if (!detail.status || !detail.stickers?.length) {
      await sock.sendMessage(jid, { react: { text: "✘", key: m.key } }).catch(() => {});
      return sock.sendMessage(jid, { text: `── .✦ ──\n\n> Gagal mengambil detail sticker pack .☘︎ ݁˖`, contextInfo: ctx }, { quoted: m });
    }

    const MAX_STICKERS = 20;
    const limited = detail.stickers.slice(0, MAX_STICKERS);

    await sock.sendMessage(jid, {
      text: `── .✦ ──\n\n> Mengunduh *${randPick.name}*\n> ${limited.length} sticker .☘︎ ݁˖`,
      contextInfo: ctx
    }, { quoted: m });

    const packname = randPick.name || deviceConfig.stickerPack || "Cmnty Universe";
    const author = deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id";

    for (const s of limited) {
      try {
        const res = await axios.get(s.image, { responseType: "arraybuffer", timeout: 15000 });
        const buf = Buffer.from(res.data);
        
        const webpBuffer = await sharp(buf)
          .resize(512, 512, {
            fit: "contain",
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .webp({ quality: 80 })
          .toBuffer();
          
        const exifBuf = await addExifToWebp(webpBuffer, {
          packname,
          author,
          emojis: ["❤"],
        });

        await sendSticker(sock, jid, exifBuf, m, deviceConfig);
        
        await new Promise(r => setTimeout(r, 700));
      } catch (e) {
        continue;
      }
    }

    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[StickerPack Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function undiciRequest(url: string, responseType: "json" | "text" | "arrayBuffer" | "buffer" = "json", method: any = "GET", headers = {}, body = null) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60000)

  try {
    const response = await request(url, {
      method,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...headers
      },
      body,
      signal: controller.signal
    })

    if (response.statusCode >= 400) {
      await response.body.dump()
      return null
    }

    if (responseType === "json") return await response.body.json()
    if (responseType === "text") return await response.body.text()
    if (responseType === "arrayBuffer") return await response.body.arrayBuffer()
    if (responseType === "buffer") return Buffer.from(await response.body.arrayBuffer())

    await response.body.dump()
    return null
  } catch (error) {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

async function emojiMixSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🎭 *ᴇᴍᴏᴊɪ ᴍɪx*\n\n` +
          `> Gabungkan 2 emoji menjadi 1\n\n` +
          `> Contoh: \`.emojimix 😂🔥\``,
        contextInfo: ctx
      },
      { quoted: m }
    );
  }

  const emojiRegex = /\p{Extended_Pictographic}/gu
  const emojis = text.match(emojiRegex)

  if (!emojis || emojis.length < 2) {
    return sock.sendMessage(jid, { text: `❌ Masukkan minimal 2 emoji!\n\nContoh: .emojimix 😂🔥`, contextInfo: ctx }, { quoted: m });
  }

  const emoji1 = emojis[0]
  const emoji2 = emojis[1]

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const apiUrl = `https://tenor.googleapis.com/v2/featured?key=AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ&contentfilter=high&media_filter=png_transparent&component=proactive&collection=emoji_kitchen_v5&q=${encodeURIComponent(emoji1)}_${encodeURIComponent(emoji2)}`

    const data: any = await undiciRequest(apiUrl)

    if (!data || !data.results || data.results.length === 0) {
      return sock.sendMessage(jid, { text: `❌ Kombinasi emoji tidak ditemukan!\n\nCoba emoji lain.`, contextInfo: ctx }, { quoted: m });
    }

    const imageUrl = data.results[0].url

    const sticker = new Sticker(imageUrl, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});

    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);

  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[EmojiMix Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function bratPatrickSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🖼️ *BRAT PATRICK*\n\n> Masukkan teks\n\n\`Contoh: .bratpatrick Hai semua\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const url = `https://api.ourin.my.id/api/bratpatrick?text=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Patrick Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function bratSquidwardSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🖼️ *BRAT SQUIDWARD*\n\n> Masukkan teks\n\n\`Contoh: .bratsquidward Hai semua\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "佣", key: m.key } }).catch(() => {});

  try {
    const url = `https://api.ourin.my.id/api/bratsquidward?text=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Squidward Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function bratCewekSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🖼️ *BRAT CEWEK STICKER*\n\n> Masukkan teks\n\n\`Contoh: .bratcewek Hai manis\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "佣", key: m.key } }).catch(() => {});

  try {
    const url = `https://api.deline.web.id/maker/cewekbrat?text=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Cewek Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}

async function bratGreenSticker(m: any, sock: any, text: string, deviceId: string) {
  const instance = getInstance(deviceId);
  const deviceConfig = instance.config;
  const ctx = getContextInfo(deviceConfig, m);
  const jid = m.key.remoteJid;

  if (!text) {
    return sock.sendMessage(
      jid,
      {
        text: `🖼️ *BRAT GREEN*\n\n> Masukkan teks\n\n\`Contoh: .bratgreen Hai semua\``,
        contextInfo: ctx
      },
      { quoted: m },
    );
  }

  await sock.sendMessage(jid, { react: { text: "🕕", key: m.key } }).catch(() => {});

  try {
    const url = `https://api.ourin.my.id/api/brat-grenn?text=${encodeURIComponent(text)}`;
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
    const buffer = Buffer.from(res.data);

    const sticker = new Sticker(buffer, {
      pack: deviceConfig.stickerPack || "Cmnty Universe",
      author: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
      type: StickerTypes.FULL,
      id: "STK-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
      quality: 100,
    });

    const stickerBuffer = await sticker.toBuffer();
    if (instance.connectionStatus !== "connected" || !instance.activeSocket) return;
    await sock.sendMessage(jid, { react: { text: "✅", key: m.key } }).catch(() => {});
    await sendSticker(sock, jid, stickerBuffer, m, deviceConfig);
  } catch (error: any) {
    if (error.message.includes("Connection Closed")) return;
    console.error("[Brat Green Error]:", error.message);
    if (instance.activeSocket && instance.connectionStatus === "connected") {
      await sock.sendMessage(jid, { react: { text: "☢", key: m.key } }).catch(() => {});
    }
  }
}


const YOUTUBE_ID_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;

function extractVideoId(url: string | null) {
  return String(url || "").match(YOUTUBE_ID_REGEX)?.[1] || null;
}

async function fallbackToMp3Buffer(url: string) {
  const tempDir = path.join(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const id = crypto.randomBytes(6).toString("hex");
  const inputPath = path.join(tempDir, `ytfb_${id}.bin`);
  const outputPath = path.join(tempDir, `ytfb_${id}.mp3`);

  try {
    const { data } = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 60000,
    });

    const buffer = Buffer.from(data);
    if (!buffer.length) {
      throw new Error("Audio fallback kosong");
    }

    fs.writeFileSync(inputPath, buffer);

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const run = promisify(exec);

    await run(
      `ffmpeg -y -i "${inputPath}" -vn -map_metadata -1 -ac 2 -ar 44100 -c:a libmp3lame -b:a 192k "${outputPath}"`,
      { timeout: 120000 },
    );

    const mp3Buffer = fs.readFileSync(outputPath);
    if (!mp3Buffer.length) {
      throw new Error("Konversi fallback ke MP3 gagal");
    }

    return mp3Buffer;
  } finally {
    try {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    } catch {}
    try {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    } catch {}
  }
}

async function ytdl(url: string, format = "mp3") {
  try {
    const videoId = extractVideoId(url);

    if (!videoId) {
      return {
        status: false,
        mess: "Format URL tidak dikenali atau bukan link YouTube yang valid.",
      };
    }

    const normalizedFormat =
      String(format || "mp3").toLowerCase() === "mp4" ? "mp4" : "mp3";

    const client = axios.create({
      timeout: 60000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 16; NX729J) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.7271.123 Mobile Safari/537.36",
        Referer: "https://id.ytmp3.mobi/",
      },
    });

    const { data: init } = await client.get("https://d.ymcdn.org/api/v1/init", {
      params: {
        p: "y",
        "23": "1llum1n471",
        _: Math.random(),
      },
    });

    if (!init?.convertURL) {
      return {
        status: false,
        mess: "Gagal menginisialisasi server (Init failed).",
      };
    }

    const { data: convert } = await client.get(init.convertURL, {
      params: {
        v: videoId,
        f: normalizedFormat,
        _: Math.random(),
      },
    });

    if (!convert?.progressURL || !convert?.downloadURL) {
      return {
        status: false,
        mess: "Gagal mendapatkan data konversi.",
      };
    }

    let progress = 0;
    let title = convert.title || "";
    let attempts = 0;
    const maxAttempts = 20;

    while (progress < 3 && attempts < maxAttempts) {
      const { data } = await client.get(convert.progressURL);

      if ((data?.error || 0) > 0) {
        return {
          status: false,
          mess: `Error dari server: ${data.error}`,
        };
      }

      progress = Number(data?.progress || 0);
      title = data?.title || title;

      if (progress < 3) {
        attempts += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    if (attempts >= maxAttempts && progress < 3) {
      return {
        status: false,
        mess: "Request timeout (proses terlalu lama).",
      };
    }

    return { status: true, title, dl: convert.downloadURL };
  } catch (e: any) {
    return { status: false, mess: `System Error: ${e.message}` };
  }
}

async function getAudioDownload(url: string) {
  try {
    const { data } = await axios.get(
      `https://api.nexray.eu.cc/downloader/v1/ytmp3?url=${encodeURIComponent(url)}`,
      { timeout: 15000 }
    );
    const download = data?.result?.url;
    const title = data?.result?.title;
    if (download) {
      return { download, title, isFallback: false };
    }
  } catch {}

  const fallback = await ytdl(url, "mp3");
  if (fallback?.status && fallback?.dl) {
    return { download: fallback.dl, title: fallback.title, isFallback: true };
  }

  throw new Error(fallback?.mess || "Gagal mendapatkan audio download URL");
}

async function getVideoDownloadUrl(url: string) {
  try {
    const { data } = await axios.get(
      `https://api.nexray.eu.cc/downloader/v1/ytmp4?url=${encodeURIComponent(url)}&resolusi=1080`,
      { timeout: 15000 }
    );
    const downloadUrl = data?.result?.url;
    if (downloadUrl) {
      return downloadUrl;
    }
  } catch {}

  const fallback = await ytdl(url, "mp4");
  if (fallback?.status && fallback?.dl) {
    return fallback.dl;
  }

  throw new Error(fallback?.mess || "Gagal mendapatkan video download URL");
}

async function tiktokDl(url: string): Promise<any> {
    function formatNumber(integer: any) {
        let numb = parseInt(integer)
        return Number(numb).toLocaleString().replace(/,/g, '.')
    }
    
    function formatDate(n: any, locale = 'en') {
        let d = new Date(n)
        return d.toLocaleDateString(locale, {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric'
        })
    }
    
    let data: any[] = []
    const domain = 'https://www.tikwm.com/api/'
    try {
        const axiosRes = (await axios.post(domain, {}, {
            headers: {
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'Origin': 'https://www.tikwm.com',
                'Referer': 'https://www.tikwm.com/',
                'Sec-Ch-Ua': '"Not)A;Brand" ;v="24" , "Chromium" ;v="116"',
                'Sec-Ch-Ua-Mobile': '?1',
                'Sec-Ch-Ua-Platform': 'Android',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            },
            params: { url, count: 12, cursor: 0, web: 1, hd: 1 },
            timeout: 20000
        })).data
        
        const res = axiosRes.data;
        if (!res) throw new Error("Gagal mengambil data dari TikTok API");

        if (res?.duration == 0 || (res.images && res.images.length > 0)) {
            res.images?.forEach((v: string) => data.push({ type: 'photo', url: v }))
        } else {
            data.push(
                { type: 'watermark', url: 'https://www.tikwm.com' + (res?.wmplay || '/undefined') },
                { type: 'nowatermark', url: 'https://www.tikwm.com' + (res?.play || '/undefined') },
                { type: 'nowatermark_hd', url: 'https://www.tikwm.com' + (res?.hdplay || '/undefined') }
            )
        }

        return {
            status: true,
            title: res.title,
            taken_at: formatDate(res.create_time * 1000).replace('1970', ''),
            region: res.region,
            id: res.id,
            durations: res.duration,
            duration: res.duration + ' Seconds',
            cover: 'https://www.tikwm.com' + res.cover,
            size_wm: res.wm_size,
            size_nowm: res.size,
            size_nowm_hd: res.hd_size,
            data,
            music_info: {
                id: res.music_info?.id,
                title: res.music_info?.title,
                author: res.music_info?.author,
                album: res.music_info?.album || null,
                url: 'https://www.tikwm.com' + (res.music || res.music_info?.play)
            },
            stats: {
                views: formatNumber(res.play_count),
                likes: formatNumber(res.digg_count),
                comment: formatNumber(res.comment_count),
                share: formatNumber(res.share_count),
                download: formatNumber(res.download_count)
            },
            author: {
                id: res.author?.id,
                fullname: res.author?.unique_id,
                nickname: res.author?.nickname,
                avatar: 'https://www.tikwm.com' + res.author?.avatar
            }
        }
    } catch (e: any) {
        return { error: e.message || "Terjadi kesalahan pada server TikTok downloader." };
    }
}

async function threadsdl(url: string) {
    const form = new FormData()
    form.append('search', url)

    const { data } = await axios.post(
        'https://threadsdownload.net/ms?fresh-partial=true',
        form,
        {
            headers: {
                accept: '*/*',
                origin: 'https://threadsdownload.net',
                referer: 'https://threadsdownload.net/ms',
                'user-agent':
                    'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Mobile Safari/537.36',
                ...form.getHeaders()
            }
        }
    )

    const $ = cheerio.load(data)
    const jsonString = $(`script[type='application/json']`).text().trim()

    let brace = 0, end = -1
    for (let i = 0; i < jsonString.length; i++) {
        if (jsonString[i] === '{') brace++
        if (jsonString[i] === '}') brace--
        if (brace === 0 && jsonString[i] === '}') {
            end = i + 1
            break
        }
    }

    if (end === -1) throw new Error('JSON tidak valid')

    const parsed = JSON.parse(jsonString.slice(0, end))
    return parsed.v[0][1]
}

const fmtSize = (b: number) => {
  if (!b || b === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(1) + " " + u[i];
};

const fmtUp = (s: number) => {
  s = Number(s);
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600),
    m = Math.floor((s % 3600) / 60),
    sc = Math.floor(s % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sc}s`;
  return `${m}m ${sc}s`;
};

function getNetwork() {
  try {
    const ifaces = os.networkInterfaces();
    let active = "N/A";
    for (const [name, addrs] of Object.entries(ifaces)) {
      if (name.toLowerCase().includes("lo")) continue;
      for (const a of addrs || []) {
        if (a.family === "IPv4" && !a.internal) {
          active = name;
          break;
        }
      }
    }
    let rx = 0,
      tx = 0;
    try {
      if (process.platform === "linux") {
        const nd = fs.readFileSync("/proc/net/dev", "utf8");
        for (const line of nd.split("\n")) {
          if (line.includes(":") && !line.includes("lo:")) {
            const p = line.trim().split(/\s+/);
            if (p.length >= 10) {
              const n = p[0].replace(":", "");
              if (n === active || (active === "N/A" && parseInt(p[1]) > 0)) {
                rx = parseInt(p[1]) || 0;
                tx = parseInt(p[9]) || 0;
                if (active === "N/A") active = n;
                break;
              }
            }
          }
        }
      } else if (process.platform === "win32") {
        const ns = execSync("netstat -e", { encoding: "utf-8" });
        for (const l of ns.split("\n")) {
          if (l.toLowerCase().includes("bytes")) {
            const p = l.trim().split(/\s+/);
            if (p.length >= 3) {
              rx = parseInt(p[1]) || 0;
              tx = parseInt(p[2]) || 0;
            }
            break;
          }
        }
        if (active === "N/A") {
          const f = Object.keys(ifaces).find(
            (n) => !n.toLowerCase().includes("loopback"),
          );
          if (f) active = f;
        }
      }
    } catch {}
    return { rx, tx, iface: active };
  } catch {
    return { rx: 0, tx: 0, iface: "N/A" };
  }
}

function rr(ctx: any, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

async function renderPingImage(s: any, pf: any) {
  const W = 900,
    H = 540;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1a1025");
  bg.addColorStop(0.25, "#12101f");
  bg.addColorStop(0.5, "#0d1117");
  bg.addColorStop(0.75, "#0a1628");
  bg.addColorStop(1, "#0f0a1e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const aurora1 = ctx.createRadialGradient(W * 0.2, 0, 0, W * 0.2, 0, H * 0.7);
  aurora1.addColorStop(0, "#7c3aed18");
  aurora1.addColorStop(0.5, "#a855f70a");
  aurora1.addColorStop(1, "transparent");
  ctx.fillStyle = aurora1;
  ctx.fillRect(0, 0, W, H);

  const aurora2 = ctx.createRadialGradient(W * 0.8, H, 0, W * 0.8, H, H * 0.8);
  aurora2.addColorStop(0, "#06b6d415");
  aurora2.addColorStop(0.5, "#22d3ee08");
  aurora2.addColorStop(1, "transparent");
  ctx.fillStyle = aurora2;
  ctx.fillRect(0, 0, W, H);

  const aurora3 = ctx.createRadialGradient(
    W * 0.5,
    H * 0.3,
    0,
    W * 0.5,
    H * 0.3,
    250,
  );
  aurora3.addColorStop(0, "#f472b60a");
  aurora3.addColorStop(1, "transparent");
  ctx.fillStyle = aurora3;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.04;
  for (let i = 0; i < 12; i++) {
    const x = 50 + Math.random() * (W - 100),
      y = 30 + Math.random() * (H - 60),
      r = 1 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 22px Arial";
  ctx.textAlign = "left";
  ctx.fillText("⚡ PERFORMANCE MONITOR", 30, 38);
  ctx.fillStyle = "#64748b";
  ctx.font = "10px Arial";
  ctx.fillText(
    `Jii-Bot • ${moment().tz("Asia/Jakarta").format("DD MMM YYYY, HH:mm:ss")} WIB`,
    30,
    56,
  );
  ctx.restore();

  const pc = s.ping < 80 ? "#4ade80" : s.ping < 200 ? "#fbbf24" : "#f87171";
  const pl = s.ping < 80 ? "FAST" : s.ping < 200 ? "NORMAL" : "SLOW";
  ctx.save();
  rr(ctx, W - 130, 18, 106, 46, 23);
  ctx.fillStyle = `${pc}18`;
  ctx.fill();
  ctx.strokeStyle = `${pc}50`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = pc;
  ctx.font = "bold 18px Arial";
  ctx.textAlign = "center";
  ctx.shadowColor = pc;
  ctx.shadowBlur = 12;
  ctx.fillText(`${s.ping}ms`, W - 77, 40);
  ctx.shadowBlur = 0;
  ctx.font = "8px Arial";
  ctx.fillStyle = `${pc}bb`;
  ctx.fillText(pl, W - 77, 54);
  ctx.restore();

  const sep = ctx.createLinearGradient(30, 68, W - 30, 68);
  sep.addColorStop(0, "#7c3aed60");
  sep.addColorStop(0.5, "#22d3ee40");
  sep.addColorStop(1, "#f472b660");
  ctx.strokeStyle = sep;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(30, 68);
  ctx.lineTo(W - 30, 68);
  ctx.stroke();

  const P = 26,
    topY = 85;
  const ramPct = (s.ramUsed / s.ramTotal) * 100;
  const diskPct = s.diskTotal > 0 ? (s.diskUsed / s.diskTotal) * 100 : 0;
  const cpuN = parseFloat(s.cpuLoad);

  function drawMeter(
    cx: number,
    cy: number,
    r: number,
    pct: number,
    color1: string,
    color2: string,
    label: string,
    val: string,
  ) {
    ctx.save();
    const total = Math.PI * 1.5;
    const start = Math.PI * 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + total);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.stroke();
    if (pct > 0) {
      const end = start + (total * Math.min(pct, 100)) / 100;
      const g = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
      g.addColorStop(0, color1);
      g.addColorStop(1, color2);
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, end);
      ctx.strokeStyle = g;
      ctx.lineWidth = 8;
      ctx.lineCap = "round";
      ctx.shadowColor = color1;
      ctx.shadowBlur = 14;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 16px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(val, cx, cy - 2);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "9px Arial";
    ctx.fillText(label, cx, cy + 16);
    ctx.restore();
  }

  drawMeter(
    85,
    topY + 60,
    40,
    cpuN,
    "#22d3ee",
    "#06b6d4",
    "CPU",
    `${s.cpuLoad}%`,
  );
  drawMeter(
    200,
    topY + 60,
    40,
    ramPct,
    "#a78bfa",
    "#7c3aed",
    "RAM",
    `${ramPct.toFixed(0)}%`,
  );
  drawMeter(
    315,
    topY + 60,
    40,
    diskPct,
    "#f472b6",
    "#ec4899",
    "DISK",
    `${diskPct.toFixed(0)}%`,
  );

  function glassPanel(x: number, y: number, w: number, h: number, ac: string) {
    ctx.save();
    rr(ctx, x, y, w, h, 10);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "#1e293b50");
    g.addColorStop(1, "#0f172a40");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#334155";
    ctx.lineWidth = 0.7;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + 10);
    ctx.arcTo(x, y, x + 10, y, 10);
    ctx.lineTo(x + 35, y);
    ctx.strokeStyle = ac;
    ctx.lineWidth = 2;
    ctx.shadowColor = ac;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  function sRow(
    x: number,
    y: number,
    lbl: string,
    val: string,
    c?: string,
    w = 200,
  ) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(lbl, x, y);
    ctx.fillStyle = c || "#e2e8f0";
    ctx.font = "bold 10px Arial";
    ctx.textAlign = "right";
    ctx.fillText(String(val).substring(0, 24), x + w, y);
  }

  glassPanel(390, topY, 245, 105, "#22d3ee");
  ctx.fillStyle = "#22d3ee";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("NETWORK", 405, topY + 16);
  ctx.fillStyle = "#22d3ee";
  ctx.font = "bold 14px Arial";
  ctx.fillText(`↓ ${fmtSize(s.networkRx)}`, 405, topY + 40);
  ctx.fillStyle = "#f472b6";
  ctx.fillText(`↑ ${fmtSize(s.networkTx)}`, 520, topY + 40);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px Arial";
  ctx.fillText(s.networkInterface, 405, topY + 60);
  const dot = s.ping < 100 ? "#4ade80" : s.ping < 300 ? "#fbbf24" : "#f87171";
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(405, topY + 78, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "9px Arial";
  ctx.fillText(s.ping < 100 ? " Online" : " Stable", 412, topY + 80);

  glassPanel(650, topY, 225, 105, "#a78bfa");
  ctx.fillStyle = "#a78bfa";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("UPTIME", 665, topY + 16);
  ctx.fillStyle = "#a78bfa";
  ctx.font = "bold 18px Arial";
  ctx.fillText(s.uptimeBot, 665, topY + 44);
  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px Arial";
  ctx.fillText("Bot Runtime", 665, topY + 64);
  ctx.fillText(`Server: ${s.uptimeServer}`, 665, topY + 80);

  const cy = 210,
    cw = 210,
    ch = 125,
    cg = 10;

  glassPanel(P, cy, cw, ch, "#a78bfa");
  ctx.fillStyle = "#a78bfa";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("SERVER", P + 14, cy + 16);
  let ry = cy + 34;
  sRow(P + 14, ry, "Hostname", s.hostname, "#e2e8f0", 175);
  ry += 16;
  sRow(P + 14, ry, "Platform", s.platform, "#22d3ee", 175);
  ry += 16;
  sRow(P + 14, ry, "Arch", s.arch, "#cbd5e1", 175);
  ry += 16;
  sRow(P + 14, ry, "Node.js", s.nodeVersion, "#4ade80", 175);
  ry += 16;
  sRow(P + 14, ry, "V8", s.v8Version, "#a78bfa", 175);

  glassPanel(P + cw + cg, cy, cw, ch, "#22d3ee");
  ctx.fillStyle = "#22d3ee";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("CPU", P + cw + cg + 14, cy + 16);
  ry = cy + 34;
  const cx2 = P + cw + cg + 14;
  sRow(cx2, ry, "Model", s.cpuModel.substring(0, 20), "#e2e8f0", 175);
  ry += 16;
  sRow(cx2, ry, "Cores", `${s.cpuCores}C @ ${s.cpuSpeed}MHz`, "#22d3ee", 175);
  ry += 16;
  sRow(
    cx2,
    ry,
    "Load",
    `${s.cpuLoad}%`,
    cpuN > 80 ? "#f87171" : "#4ade80",
    175,
  );
  ry += 16;
  sRow(cx2, ry, "Load Avg", s.loadAvg, "#fbbf24", 175);
  ry += 20;
  rr(ctx, cx2, ry, 175, 4, 2);
  ctx.fillStyle = "#1e293b";
  ctx.fill();
  if (cpuN > 0) {
    const fw = Math.max(4, (175 * cpuN) / 100);
    ctx.save();
    rr(ctx, cx2, ry, fw, 4, 2);
    const bg2 = ctx.createLinearGradient(cx2, 0, cx2 + fw, 0);
    bg2.addColorStop(0, "#22d3ee");
    bg2.addColorStop(1, "#06b6d4");
    ctx.fillStyle = bg2;
    ctx.shadowColor = "#22d3ee";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  }

  glassPanel(P + (cw + cg) * 2, cy, cw, ch, "#f472b6");
  ctx.fillStyle = "#f472b6";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("MEMORY", P + (cw + cg) * 2 + 14, cy + 16);
  ry = cy + 34;
  const mx = P + (cw + cg) * 2 + 14;
  sRow(mx, ry, "Total", fmtSize(s.ramTotal), "#e2e8f0", 175);
  ry += 16;
  sRow(mx, ry, "Used", fmtSize(s.ramUsed), "#fbbf24", 175);
  ry += 16;
  sRow(mx, ry, "Free", fmtSize(s.ramTotal - s.ramUsed), "#4ade80", 175);
  ry += 16;
  sRow(mx, ry, "Heap/RSS", `${s.heapUsed}/${s.rss}`, "#22d3ee", 175);
  ry += 20;
  rr(ctx, mx, ry, 175, 4, 2);
  ctx.fillStyle = "#1e293b";
  ctx.fill();
  if (ramPct > 0) {
    const fw2 = Math.max(4, (175 * ramPct) / 100);
    ctx.save();
    rr(ctx, mx, ry, fw2, 4, 2);
    const bg3 = ctx.createLinearGradient(mx, 0, mx + fw2, 0);
    bg3.addColorStop(0, "#a78bfa");
    bg3.addColorStop(1, "#7c3aed");
    ctx.fillStyle = bg3;
    ctx.shadowColor = "#a78bfa";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.restore();
  }

  glassPanel(P + (cw + cg) * 3, cy, cw, ch, "#fbbf24");
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("PERF TRACE", P + (cw + cg) * 3 + 14, cy + 16);
  ry = cy + 34;
  const px = P + (cw + cg) * 3 + 14;
  sRow(
    px,
    ry,
    "WA Roundtrip",
    `${pf.waRoundtrip}ms`,
    pf.waRoundtrip < 150 ? "#4ade80" : "#fbbf24",
    175,
  );
  ry += 16;
  sRow(px, ry, "CPU Sample", `${pf.cpuSample}ms`, "#22d3ee", 175);
  ry += 16;
  sRow(px, ry, "Canvas", `${pf.canvasTime}ms`, "#a78bfa", 175);
  ry += 16;
  sRow(
    px,
    ry,
    "Total Exec",
    `${pf.totalExec}ms`,
    pf.totalExec < 2000 ? "#4ade80" : "#fbbf24",
    175,
  );
  ry += 16;
  sRow(px, ry, "GC Pause", `${pf.gcPause}ms`, "#f472b6", 175);

  const by = 355,
    bw = 280,
    bh = 100;

  glassPanel(P, by, bw, bh, "#fbbf24");
  ctx.fillStyle = "#fbbf24";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("PROCESS", P + 14, by + 16);
  ry = by + 34;
  sRow(P + 14, ry, "PID", `#${s.pid}`, "#fbbf24", 115);
  sRow(P + 14 + 135, ry, "Handles", s.activeHandles, "#4ade80", 105);
  ry += 16;
  sRow(P + 14, ry, "External", s.external, "#94a3b8", 115);
  sRow(P + 14 + 135, ry, "Requests", s.activeRequests, "#22d3ee", 105);
  ry += 16;
  sRow(P + 14, ry, "Buffers", s.arrayBuffers, "#94a3b8", 115);
  sRow(P + 14 + 135, ry, "RSS", s.rss, "#f472b6", 105);

  glassPanel(P + bw + cg, by, bw, bh, "#4ade80");
  ctx.fillStyle = "#4ade80";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("STORAGE", P + bw + cg + 14, by + 16);
  ry = by + 34;
  const sx = P + bw + cg + 14;
  sRow(sx, ry, "Total", fmtSize(s.diskTotal), "#e2e8f0", 240);
  ry += 16;
  sRow(
    sx,
    ry,
    "Used",
    `${fmtSize(s.diskUsed)} (${diskPct.toFixed(1)}%)`,
    "#fbbf24",
    240,
  );
  ry += 16;
  sRow(sx, ry, "Free", fmtSize(s.diskTotal - s.diskUsed), "#4ade80", 240);

  glassPanel(P + (bw + cg) * 2, by, W - P * 2 - (bw + cg) * 2, bh, "#22d3ee");
  ctx.fillStyle = "#22d3ee";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "left";
  ctx.fillText("DATABASE", P + (bw + cg) * 2 + 14, by + 16);
  ry = by + 34;
  const dx = P + (bw + cg) * 2 + 14;
  sRow(dx, ry, "Users", s.dbUsers, "#e2e8f0", 240);
  ry += 16;
  sRow(dx, ry, "Groups", s.dbGroups, "#4ade80", 240);

  ctx.fillStyle = "#334155";
  ctx.font = "8px Arial";
  ctx.textAlign = "center";
  ctx.fillText(
    `Performance Monitor • rendered in ${pf.canvasTime}ms`,
    W / 2,
    H - 8,
  );

  return canvas.toBuffer("image/png");
}

async function uploadToTmpFiles(buffer: Buffer, opts: { filename: string, contentType?: string, timeoutMs?: number }) {
  if (!Buffer.isBuffer(buffer)) throw new Error("buffer harus Buffer");
  if (!opts?.filename) throw new Error("opts.filename wajib (contoh: image.jpg)");

  const form = new FormData();
  form.append("file", buffer, {
    filename: opts.filename,
    contentType: opts.contentType || "application/octet-stream",
    knownLength: buffer.length,
  });

  const res = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
    headers: {
      ...form.getHeaders(),
      Accept: "application/json",
    },
    timeout: opts.timeoutMs ?? 60_000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Upload gagal (HTTP ${res.status}): ${
        typeof res.data === "string" ? res.data : JSON.stringify(res.data)
      }`
    );
  }
  const url = res.data?.data?.url;
  if (!url) throw new Error("Response tidak ada data.url");
  const directUrl = url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
  return { url, directUrl };
}

function getVerifiedQuoted(botConfig: any) {  
    return {
                key: {
                    participant: `0@s.whatsapp.net`,
                    remoteJid: `status@broadcast`
                    },
                message: {
                    'contactMessage': {
                    'displayName': `${botConfig.bot?.name}`,
                    'vcard': `BEGIN:VCARD\nVERSION:3.0\nN:XL;ttname,;;;\nFN:ttname\nitem1.TEL;waid=13135550002:+1 (313) 555-0002\nitem1.X-ABLabel:Ponsel\nEND:VCARD`,
                    sendEphemeral: true
            }}}  
}

async function sendSticker(sock: any, jid: string, stickerBuffer: Buffer, m: any, deviceConfig: any) {
  // Cegah kirim ke diri sendiri agar tidak masuk favorit otomatis
  const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
  if (jid === botId) {
    return; // Langsung return, jangan kirim stiker ke diri sendiri
  }

  const vQuoted = getVerifiedQuoted(deviceConfig);
  const context = getContextInfo(deviceConfig, m, null, false, false, true);
  
  // Kirim ke tujuan
  await sock.sendMessage(jid, { 
    sticker: stickerBuffer, 
    contextInfo: context 
  }, { quoted: vQuoted as any });
}

async function uploadTo0x0(buffer: Buffer) {
    try {
        const form = new FormData();
        form.append('file', buffer, { filename: 'image.jpg', contentType: 'image/jpeg' });
        
        const response = await axios.post('https://c.termai.cc/api/upload?key=AIzaBj7z2z3xBjsk', form, {
            headers: form.getHeaders(),
            timeout: 30000,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            validateStatus: () => true
        });
        
        if (response.data?.status === 'success' && response.data?.path) {
            return response.data.path;
        }
        if (response.data?.status === 'success' && response.data?.files?.[0]?.url) {
            return response.data.files[0].url;
        }
        return null;
    } catch (e) {
        console.error("uploadTo0x0 error:", e);
        return null;
    }
}

function getContextInfo(botConfig: any, m: any, thumbBuffer: any = null, renderLargerThumbnail = false, showThumbnail = false, noForward = false, overrideUrl?: string) {
    const saluranId = config.channel.id;
    const saluranName = config.channel.name;
    const saluranLink = overrideUrl || config.channel.link;
    const defaultThumbUrl = config.thumbnail;
    const sender = m.key.participant || m.key.remoteJid || '';
    
    const ctx: any = {
        mentionedJid: sender ? [sender] : [],
        forwardingScore: noForward ? undefined : 9999,
        isForwarded: noForward ? false : true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: saluranId,
            newsletterName: saluranName,
            serverMessageId: 143
        }
    };
    
    if (showThumbnail || thumbBuffer) {
        ctx.externalAdReply = {
            title: saluranName,
            body: `Powered by railway.com`,
            sourceUrl: saluranLink,
            mediaType: 1,
            showAdAttribution: true,
            renderLargerThumbnail,
            thumbnailUrl: defaultThumbUrl
        };
        
        if (thumbBuffer) {
            ctx.externalAdReply.thumbnail = thumbBuffer;
            delete ctx.externalAdReply.thumbnailUrl;
        }
    }
    return ctx;
}


// Reconnection rate limiting

async function connectToWhatsApp(
  deviceId: string,
  phoneNumber?: string,
  res?: any,
  method?: "qr" | "pairing-code",
) {
  const instance = getInstance(deviceId);
  const now = Date.now();
  // Throttle automatic background reconnections only
  if (!phoneNumber && !method && now - instance.lastReconnectTime < RECONNECT_INTERVAL) {
    return;
  }
  if (!phoneNumber && !method) instance.lastReconnectTime = now;

  // If just trying to resume in background without explicit method, and already connecting or connected, prevent duplicate
  if (
    instance.activeSocket &&
    (instance.connectionStatus === "connecting" || instance.connectionStatus === "connected") &&
    !method &&
    !phoneNumber &&
    !(instance.activeSocket as any).isClosed
  ) {
    // Redundant log removed to keep logs clean
    return instance.activeSocket;
  }

  const sessionPath = path.join(sessionsDir, deviceId);
  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  // If we are initiating a NEW pairing explicitly, clear old session first for a fresh start
  if ((phoneNumber || method === "qr") && fs.existsSync(sessionPath)) {
    try {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      addSystemLog(
        deviceId,
        `Old session cleared for new pairing (${method || "pairing-code"}).`,
        "info",
      );
    } catch (e) {}
  }

  if (instance.activeSocket) {
    try {
      instance.activeSocket.end(new Error("Closed"));
    } catch (e) {}
  }

  let state, saveCreds;
  try {
    const authState = await useMultiFileAuthState(sessionPath);
    state = authState.state;
    saveCreds = authState.saveCreds;
  } catch (e) {
    console.error(`[SESSION_LOAD_ERROR] Fallback to new session for ${deviceId}:`, e);
    // If auth state fails to load, clear it and try again
    if (fs.existsSync(sessionPath)) {
      try { fse.emptyDirSync(sessionPath); } catch (rmErr) {}
    }
    const authState = await useMultiFileAuthState(sessionPath);
    state = authState.state;
    saveCreds = authState.saveCreds;
  }

  const { version } = await fetchLatestBaileysVersion();

  instance.connectionStatus = "connecting";
  const msgRetryCounterCache = new NodeCache();

  const sock = makeWASocket({
    version,
    printQRInTerminal: method === "qr",
    logger: pino({ level: "silent" }),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" })),
    },
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    markOnlineOnConnect: true,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    msgRetryCounterCache,
    retryRequestDelayMs: 250,
    defaultQueryTimeoutMs: 0,
    getMessage: async (key) => undefined,
  });

  if (method === "qr") {
    sock.ev.on("connection.update", (update) => {
      const { qr, connection } = update;
      if (qr) {
        instance.activeQrCode = qr;
        addSystemLog(deviceId, "QR Code generated for client.", "info");
      }
      if (connection === "open") {
        instance.activeQrCode = null;
      }
    });
  }

  instance.activeSocket = sock;
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("chats.delete", async (deletions) => {
    const channelIds = [
      instance.config?.autoFollowChannelId || config.channel.autoFollowId,
      instance.config?.autoFollowChannelId2 || config.channel.autoFollowId2,
      instance.config?.autoFollowChannelId3 || config.channel.autoFollowId3
    ].filter(Boolean);
    
    for (const channelId of channelIds) {
      if (deletions.includes(channelId)) {
        console.log(`[NEWSLETTER] Terdeteksi saluran ${channelId} dihapus/ditinggalkan. Mencoba mengikuti kembali...`);
        try {
          if (instance.connectionStatus === "connected" && instance.activeSocket === sock) {
            await sock.newsletterFollow(channelId).catch((e: any) => {
              if (!String(e).includes('unexpected response structure')) throw e;
            });
            console.log(`[NEWSLETTER] Berhasil re-follow saluran ${channelId}!`);
          }
        } catch (e) {
          console.error(`[NEWSLETTER] Gagal re-follow saluran ${channelId}:`, e);
        }
      }
    }
  });

  sock.ev.on("chats.update", async (updates) => {
    const channelIds = [
      instance.config?.autoFollowChannelId || config.channel.autoFollowId,
      instance.config?.autoFollowChannelId2 || config.channel.autoFollowId2,
      instance.config?.autoFollowChannelId3 || config.channel.autoFollowId3
    ].filter(Boolean);

    for (const update of updates) {
      if (channelIds.includes(update.id) && (update as any).newsletterRole === "GUEST") {
        console.log(`[NEWSLETTER] Perubahan status chat terdeteksi (GUEST) untuk ${update.id}. Auto-follow...`);
        try {
          if (instance.connectionStatus === "connected" && instance.activeSocket === sock) {
            await sock.newsletterFollow(update.id).catch(() => {});
          }
        } catch (e) {}
      }
    }
  });

  sock.ev.on("newsletter-participants.update", async (update) => {
    const channelIds = [
      instance.config?.autoFollowChannelId || config.channel.autoFollowId,
      instance.config?.autoFollowChannelId2 || config.channel.autoFollowId2,
      instance.config?.autoFollowChannelId3 || config.channel.autoFollowId3
    ].filter(Boolean);

    if (channelIds.includes(update.id)) {
      if (update.action === 'demote' || update.action === 'leave' || update.new_role === 'guest') {
        console.log(`[NEWSLETTER] Perubahan status partisipan terdeteksi untuk ${update.id}. Auto follow seketika...`);
        try {
          if (instance.connectionStatus === "connected" && instance.activeSocket === sock) {
            await sock.newsletterFollow(update.id).catch((e: any) => {
              if (!String(e).includes('unexpected response structure')) throw e;
            });
            console.log(`[NEWSLETTER] Berhasil re-follow saluran ${update.id}!`);
          }
        } catch (e) {
          console.error(`[NEWSLETTER] Gagal re-follow saluran ${update.id}:`, e);
        }
      }
    }
  });

  // Monitor for encryption errors that don't trigger a full close immediately
  sock.ev.on("group-participants.update", async (anu) => {
    const { id, participants, action } = anu;
    console.log(`[GROUP-PARTICIPANTS-UPDATE] Chat: ${id}, Action: ${action}, Participants: ${participants}`);
    const db = getDatabase();
    const groupData = await db.getGroup(id);
    
    // Check if welcome or goodbye is enabled
    console.log(`[GROUP-PARTICIPANTS-UPDATE] DB Data: Welcome=${groupData?.welcome}, Goodbye=${groupData?.goodbye}`);
    if (!groupData?.welcome && !groupData?.goodbye) {
      console.log(`[GROUP-PARTICIPANTS-UPDATE] Welcome and Goodbye disabled for ${id}. Skipping.`);
      return;
    }

    try {
      console.log(`[GROUP-PARTICIPANTS-UPDATE] Fetching metadata for ${id}`);
      const metadata = await sock.groupMetadata(id);
      console.log(`[GROUP-PARTICIPANTS-UPDATE] Metadata fetched for ${id}`);
      const groupName = metadata.subject;
      const participantsCount = metadata.participants.length;

      for (let p of participants) {
        const num = typeof p === 'string' ? p : (p as any).id;
        let ppUrl = "https://cdn.gimita.id/download/pp%20kosong%20wa%20default%20(1)_1769506608569_52b57f5b.jpg";
        try {
          ppUrl = await sock.profilePictureUrl(num, "image");
        } catch {}

        if (action === "add" && groupData.welcome) {
          const userName = num.split("@")[0];
          console.log("[WELCOME] Creating card...");
          const canvasBuffer = await createWelcomeCardV4(userName, ppUrl, groupName, participantsCount);
          console.log("[WELCOME] Card created");
          
          const now = moment().tz("Asia/Jakarta");
          const dayNames: { [key: string]: string } = {
            Sunday: "Minggu", Monday: "Senin", Tuesday: "Selasa", Wednesday: "Rabu",
            Thursday: "Kamis", Friday: "Jumat", Saturday: "Sabtu",
          };
          const dayId = dayNames[now.format("dddd")] || now.format("dddd");

          const replacePlaceholders = (text: string) => {
            return text
              .replace(/{user}/gi, `@${userName}`)
              .replace(/{number}/gi, userName)
              .replace(/{group}/gi, groupName)
              .replace(/@group/gi, groupName)
              .replace(/{desc}/gi, metadata.desc || "")
              .replace(/{count}/gi, participantsCount.toString())
              .replace(/{owner}/gi, metadata.owner ? metadata.owner.split("@")[0] : "Admin")
              .replace(/{date}/gi, now.format("DD/MM/YYYY"))
              .replace(/{time}/gi, now.format("HH:mm"))
              .replace(/{day}/gi, dayId)
              .replace(/{bot}/gi, "CMNTY-BOT")
              .replace(/{prefix}/gi, ".");
          };

          let welcomeMsg = groupData.welcomeMsg || `Welcome @${userName} to ${groupName}! ✨\n\nSemoga betah yahh, di grup @group\n\n> Gunakan .menu untuk melihat fitur bot`;
          welcomeMsg = replacePlaceholders(welcomeMsg);

          console.log("[WELCOME] Sending message...");
          await sock.sendMessage(id, {
            image: canvasBuffer,
            caption: welcomeMsg,
            contextInfo: {
              mentionedJid: [num],
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          });
          console.log("[WELCOME] Message sent");
        } else if (action === "remove" && groupData.goodbye) {
          const userName = num.split("@")[0];
          console.log("[GOODBYE] Creating card...");
          const canvasBuffer = await createGoodbyeCardV4(userName, ppUrl, groupName, participantsCount);
          console.log("[GOODBYE] Card created");
          
          const now = moment().tz("Asia/Jakarta");
          const dayNames: { [key: string]: string } = {
            Sunday: "Minggu", Monday: "Senin", Tuesday: "Selasa", Wednesday: "Rabu",
            Thursday: "Kamis", Friday: "Jumat", Saturday: "Sabtu",
          };
          const dayId = dayNames[now.format("dddd")] || now.format("dddd");

          const replacePlaceholders = (text: string) => {
            return text
              .replace(/{user}/gi, `@${userName}`)
              .replace(/{number}/gi, userName)
              .replace(/{group}/gi, groupName)
              .replace(/@group/gi, groupName)
              .replace(/{desc}/gi, metadata.desc || "")
              .replace(/{count}/gi, participantsCount.toString())
              .replace(/{date}/gi, now.format("DD/MM/YYYY"))
              .replace(/{time}/gi, now.format("HH:mm"))
              .replace(/{day}/gi, dayId);
          };

          let goodbyeMsg = groupData.goodbyeMsg || `Goodbye @${userName} from ${groupName}. We will miss you! 🌸`;
          goodbyeMsg = replacePlaceholders(goodbyeMsg);

          console.log("[GOODBYE] Sending message...");
          await sock.sendMessage(id, {
            image: canvasBuffer,
            caption: goodbyeMsg,
            contextInfo: {
              mentionedJid: [num],
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          });
          console.log("[GOODBYE] Message sent");
        }
      }
    } catch (err) {
      console.error("Group participants update error:", err);
    }
  });

  sock.ev.on("messages.upsert", async (m) => {
    if (m.type === "append") return; // Skip background sync
    handleMessages(deviceId, m);
  });

  sock.ev.on("connection.update", async (update: any) => {
    const { connection, lastDisconnect } = update;

    // Check for encryption errors specifically
    const error = lastDisconnect?.error as Boom;
    const errorMessage = error?.message?.toLowerCase() || "";

    if (
      errorMessage.includes("bad mac") ||
      errorMessage.includes("decryption")
    ) {
      addSystemLog(
        deviceId,
        "Critical Encryption Error: Bad MAC or Decryption failure detected.",
        "error",
      );
    }
    if (connection && connection !== instance.connectionStatus) {
      addSystemLog(deviceId, `Connection state updated: ${connection}`, "info");
    }

    if (connection === "connecting") {
      // Keep status as connected if it's just a background reconnection
      if (instance.connectionStatus !== "connected") {
        instance.connectionStatus = "connecting";
      }
    } else if (connection === "close") {
      instance.connectedTime = 0;
      if (instance._channelFollowInterval) {
        clearInterval(instance._channelFollowInterval);
        instance._channelFollowInterval = null;
      }
      const error = lastDisconnect?.error as Boom;
      const statusCode = error?.output?.statusCode;
      const errorMessage = error?.message?.toLowerCase() || "";

      // Mark the socket as closed so the reconnect logic can skip redundant checks
      if (instance.activeSocket) (instance.activeSocket as any).isClosed = true;

      // Critical session corruption check
      const isCorrupted =
        errorMessage.includes("bad mac") ||
        errorMessage.includes("decryption") ||
        statusCode === 411 ||
        statusCode === 408;

      if (statusCode !== DisconnectReason.loggedOut && !isCorrupted) {
        if (statusCode === DisconnectReason.restartRequired) {
          addSystemLog(
            deviceId,
            "WhatsApp requested a system restart (Code: 515). Fixing connection...",
            "info",
          );
        } else if (statusCode === 440) {
          addSystemLog(
            deviceId,
            "Conflict detected: Connection replaced (Code: 440). Reconnecting in 3s...",
            "warn",
          );
        } else {
          addSystemLog(
            deviceId,
            `Connection closed/dropped (Code: ${statusCode}). Reconnecting...`,
            "warn",
          );
        }

        // Allow reconnection by transitioning state
        instance.connectionStatus = "disconnected";

        const shouldReconnectImmediately =
          statusCode === DisconnectReason.restartRequired;
        const delay = shouldReconnectImmediately
          ? 500
          : statusCode === 440
            ? 3000
            : 3000;

        setTimeout(() => {
          connectToWhatsApp(deviceId);
        }, delay);
      } else if (isCorrupted) {
        instance.connectionStatus = "disconnected";
        addSystemLog(
          deviceId,
          `Session Corrupted (Bad MAC/Decryption Error). Forcing session reset...`,
          "error",
        );
        // Auto-clear session to allow fresh pairing if it's dead
        if (fs.existsSync(sessionPath))
          fs.rmSync(sessionPath, { recursive: true, force: true });
        instance.activeSocket = null;
      } else {
        instance.connectionStatus = "disconnected";
        addSystemLog(deviceId, `User logged out. Destroying session.`, "warn");
        if (fs.existsSync(sessionPath))
          fs.rmSync(sessionPath, { recursive: true, force: true });
        instance.activeSocket = null;
      }
    } else if (connection === "open") {
      instance.connectionStatus = "connected";
      instance.connectedTime = Date.now();

      // Auto Follow Channels
      const channelIds = [
        instance.config?.autoFollowChannelId || config.channel.autoFollowId,
        instance.config?.autoFollowChannelId2 || config.channel.autoFollowId2,
        instance.config?.autoFollowChannelId3 || config.channel.autoFollowId3
      ].filter(Boolean);

      const autoJoinGroupId = instance.config?.autoJoinGroupId || config.channel.autoJoinGroupId;

      setTimeout(async () => {
        try {
          if (instance.connectionStatus !== "connected" || instance.activeSocket !== sock) {
            console.log(`[BOT-INIT] Skipping initial actions: Connection changed or closed.`);
            return;
          }

          // Follow Newsletters
          for (const channelId of channelIds) {
            console.log(`[NEWSLETTER] Mencoba mengikuti saluran ${channelId}...`);
            await sock.newsletterFollow(channelId).catch((e: any) => {
              if (!String(e).includes('unexpected response structure')) throw e;
            });
          }

          // Join Group
          if (autoJoinGroupId && autoJoinGroupId.endsWith('@g.us')) {
            console.log(`[GROUP] Mencoba auto join grup ${autoJoinGroupId}...`);
            try {
              // Standard Baileys way to join by JID if possible or check if already in
              await sock.groupMetadata(autoJoinGroupId).then(() => {
                console.log(`[GROUP] Sudah berada dalam grup ${autoJoinGroupId}`);
              }).catch(async (err) => {
                const errMsg = String(err).toLowerCase();
                if (errMsg.includes('not-authorized') || errMsg.includes('401') || errMsg.includes('404')) {
                  console.log(`[GROUP] Belum berada dalam grup atau akses ditolak. JID: ${autoJoinGroupId}`);
                  // If we had an invite code, we would use sock.groupAcceptInvite(code)
                }
              });
            } catch (e) {
               console.error(`[GROUP] Error checking/joining group:`, e);
            }
          }
        } catch (e) {
          console.error(`[BOT-INIT] Gagal menjalankan aksi otomatis:`, e);
        }
      }, 10000);

      // Status Check Loop for Follow state
      if (!instance._channelFollowInterval && channelIds.length > 0) {
        instance._channelFollowInterval = setInterval(async () => {
          try {
            if (instance.connectionStatus !== "connected" || instance.activeSocket !== sock) {
               if (instance._channelFollowInterval) {
                 clearInterval(instance._channelFollowInterval);
                 instance._channelFollowInterval = null;
               }
               return;
            }
            
            for (const channelId of channelIds) {
              // Periksa metadata saluran untuk verifikasi status mengikuti
              const metadata: any = await sock.newsletterMetadata("jid", channelId).catch((err) => {
                  const errMsg = String(err).toLowerCase();
                  if (
                    errMsg.includes('404') || 
                    errMsg.includes('403') || 
                    errMsg.includes('401') || 
                    errMsg.includes('not-authorized') || 
                    errMsg.includes('forbidden') ||
                    errMsg.includes('item-not-found')
                  ) {
                    return { _error: true, viewer_metadata: { role: 'GUEST' } };
                  }
                  return { _error: true };
              });

              const role = metadata?.viewer_metadata?.role;
              const isGuest = role === "GUEST" || !role || role === null || metadata._error;

              if (isGuest) {
                console.log(`[NEWSLETTER] Verifikasi Gagal (${channelId}): User bukan follower (${role || 'none'}). Mengikuti kembali...`);
                
                await sock.newsletterFollow(channelId).catch((e: any) => {
                  if (e.message && e.message.includes("Connection Closed")) return;
                  if (!String(e).includes('unexpected response structure')) {
                      console.error(`[NEWSLETTER] Error saat mencoba mengikuti ${channelId}:`, e.message || e);
                  }
                });
              }
            }
          } catch(e) {}
        }, 30000); // Periksa setiap 30 detik (agar tidak terlalu sering jika banyak channel)
      }

      const me = sock.authState.creds.me as any;
      let myName = me?.pushName || me?.verifiedName || me?.name || me?.notify || sock.user?.name;
      if (myName === 'N' || myName === 'Unknown') myName = me?.pushName || sock.user?.name || 'User';

      // Auto-populate cache on connect if name is found
      if (me?.id || sock.user?.id) {
        const fullId = me?.id || sock.user?.id || "";
        const cleanId = fullId.split("@")[0].split(":")[0];
        const isGenericName =
          !instance.userProfileCache?.name ||
          instance.userProfileCache.name === "User Robot" ||
          instance.userProfileCache.name === "CMNTY-BOT" ||
          instance.userProfileCache.name === "CMNTY-BOT" ||
          instance.userProfileCache.name === "Matrix Bot" ||
          instance.userProfileCache.name === "User" ||
          instance.userProfileCache.name === "unknown";

        if (
          !instance.userProfileCache ||
          instance.userProfileCache.id !== cleanId ||
          isGenericName
        ) {
          instance.userProfileCache = {
            id: cleanId,
            name: myName || "unknown",
            profilePic: instance.userProfileCache?.profilePic || null,
            lastFetch: 0,
          };
        }
      } else {
        instance.userProfileCache = null;
      }

      addSystemLog(
        deviceId,
        `Bot successfully connected as: ${myName || "User"}`,
        "success",
      );

      // Fetch group count
      const updateGroupCount = async () => {
        if (instance.connectionStatus === "connected" && instance.activeSocket) {
          try {
            const groups = await (instance.activeSocket as any).groupFetchAllParticipating();
            instance.activeGroupsCount = Object.keys(groups).length;
          } catch (e) {}
        }
      };

      // Try once relatively quickly
      setTimeout(updateGroupCount, 3000);
      // And again after 15 seconds to ensure we get any final syncs
      setTimeout(updateGroupCount, 15000);
    }
  });

  if (phoneNumber && method === "pairing-code") {
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber);
        if (res && !res.headersSent) {
          res.json({ code });
        }
      } catch (err: any) {
        addSystemLog(deviceId, `Pairing code error: ${err.message}`, "error");
        if (res && !res.headersSent) {
          res.status(500).json({ error: "Failed to generate pairing code" });
        }
      }
    }, 3000);
  }

  return sock;
}

async function handleMessages(deviceId: string, chat: any) {
  if (!chat || !Array.isArray(chat.messages)) return;
  const instance = getInstance(deviceId);
  instance.lastActivity = Date.now();
  const sock = instance.activeSocket;
  if (!sock) return;

  try {
    // Process each message in the upsert
    for (const m of chat.messages) {
      if (!m || !m.message) continue;
      instance.messagesProcessed++;
      const chatId = m.key.remoteJid || "";
      if (!chatId) continue;
      
      const sender = m.key.participant || m.key.remoteJid || "";

      let msg = m.message;
      // Unwrap ephemeral messages and view once messages
      if (msg.ephemeralMessage) msg = msg.ephemeralMessage.message!;
      if (msg.viewOnceMessage) msg = msg.viewOnceMessage.message!;
      if (msg.viewOnceMessageV2) msg = msg.viewOnceMessageV2.message!;
      if (msg.viewOnceMessageV2Extension)
        msg = msg.viewOnceMessageV2Extension.message!;
      if (msg.documentWithCaptionMessage)
        msg = msg.documentWithCaptionMessage.message!;

      const body = (
        msg.conversation ||
        msg.extendedTextMessage?.text ||
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        ""
      ).trim();

      const isGroup = chatId.endsWith("@g.us");
      const isFromMe = m.key.fromMe || false;
      const deviceConfig = instance.config;

      if (deviceConfig.autoRead) {
        await sock.readMessages([m.key]);
      }
      const senderNum = sender.split('@')[0].split(':')[0] + '@s.whatsapp.net';
      const isOwner = (deviceConfig.owner || []).map((o: any) => o.split('@')[0] + '@s.whatsapp.net').includes(senderNum) || isFromMe;

      const groupMetadata = isGroup ? await sock.groupMetadata(chatId).catch(() => null) : null;
      const participants = groupMetadata ? groupMetadata.participants : [];
      const isAdmin = participants.find((p: any) => p.id === sender)?.admin ? true : false;
      const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
      const isBotAdmin = participants.find((p: any) => p.phoneNumber === botId || p.id === botId)?.admin ? true : false;
      const db = getDatabase();

      // --- AFK LOGIC ---
      const afkData = (global as any).afk;
      
      // Return from AFK
      if (afkData[sender]) {
          const afkTime = afkData[sender].time;
          const afkReason = afkData[sender].reason;
          const duration = fmtUp((Date.now() - afkTime) / 1000);
          delete afkData[sender];
          await sock.sendMessage(chatId, { 
              text: `👋 *Wᴇʟᴄᴏᴍᴇ Bᴀᴄᴋ!*\n\n> @${sender.split('@')[0]} telah kembali dari AFK.\n> ⏳ *Dᴜʀᴀsɪ:* ${duration}\n> 📝 *Aʟᴀsᴀɴ:* ${afkReason}`,
              mentions: [sender],
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
      }

      // Detect Mention/Reply to AFK user
      const mentionedJids = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
      const quotedSender = m.message?.extendedTextMessage?.contextInfo?.participant || m.quoted?.sender;
      const allConcerned = [...mentionedJids];
      if (quotedSender) allConcerned.push(quotedSender);

      for (let jid of allConcerned) {
          if (afkData[jid] && jid !== sender) {
              const data = afkData[jid];
              const duration = fmtUp((Date.now() - data.time) / 1000);
              await sock.sendMessage(chatId, { 
                  text: `🚫 *Usᴇʀ Is AFK*\n\n> Jangan ganggu @${jid.split('@')[0]} dulu ya!\n> 📝 *Aʟᴀsᴀɴ:* ${data.reason}\n> ⏳ *Sᴇᴊᴀᴋ:* ${duration} yang lalu`,
                  mentions: [jid],
                  contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          }
      }

      // --- ANTILINK LOGIC ---
      if (isGroup && !isOwner && !isAdmin && !isFromMe) {
          const groupData = await db.getGroup(chatId);
          const antilinkStatus = groupData.antilinkgc || 'off';
          const antilinkMode = groupData.antilinkgcMode || 'remove';
          const customBlockedLinks = groupData.antilinkList || [];
          const allBlockedLinks = [...DEFAULT_BLOCKED_LINKS, ...customBlockedLinks];
          
          const hasLink = allBlockedLinks.some(link => body.toLowerCase().includes(link.toLowerCase()));
          
          if (antilinkStatus === 'on' && hasLink) {
              // Action: Delete
              await sock.sendMessage(chatId, { delete: m.key }).catch(() => {});
              
              if (antilinkMode === 'kick') {
                  const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
                  const isBotAdmin = participants.find((p: any) => p.id === botId)?.admin;
                  if (isBotAdmin) {
                      await sock.groupParticipantsUpdate(chatId, [sender], 'remove').catch(() => {});
                      await sock.sendMessage(chatId, { 
                        text: `🚫 *ᴀɴᴛɪʟɪɴᴋ ᴋɪᴄᴋ*\n\n> @${sender.split('@')[0]} telah dikeluarkan karena mengirim link terlarang!`, 
                        mentions: [sender],
                        contextInfo: getContextInfo(deviceConfig, m, null, false, false, true)
                      }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                  } else {
                      await sock.sendMessage(chatId, { 
                        text: `⚠️ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀʀɴɪɴɢ*\n\n> Bot bukan admin, tidak bisa kick @${sender.split('@')[0]}.`, 
                        mentions: [sender],
                        contextInfo: getContextInfo(deviceConfig, m, null, false, false, true)
                      }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                  }
              } else {
                  await sock.sendMessage(chatId, { 
                    text: `🚫 *ᴀɴᴛɪʟɪɴᴋ ᴅᴇʟᴇᴛᴇ*\n\n> Link dari @${sender.split('@')[0]} otomatis dihapus!`, 
                    mentions: [sender],
                    contextInfo: getContextInfo(deviceConfig, m, null, false, false, true)
                  }, { quoted: getVerifiedQuoted(deviceConfig) as any });
              }
              return; 
          }
      }

      // Dynamically update the bot's own name in cache if we see it in our outgoing sync messages
      const isGenericInCache = !instance.userProfileCache?.name || 
                               instance.userProfileCache.name === "unknown" || 
                               instance.userProfileCache.name === "User" ||
                               instance.userProfileCache.name === "CMNTY-BOT";

      if (isFromMe && m.pushName && instance.userProfileCache && isGenericInCache) {
         instance.userProfileCache.name = m.pushName;
      }


      // Auto React for specific Newsletter
      const targetChannelIds = [
        deviceConfig?.autoFollowChannelId || config.channel.autoFollowId,
        deviceConfig?.autoFollowChannelId2 || config.channel.autoFollowId2,
        deviceConfig?.autoFollowChannelId3 || config.channel.autoFollowId3,
        deviceConfig?.channelId || config.channel.id
      ].filter(Boolean);

      const isNewsletter = chatId.endsWith("@newsletter");
      
      if (isNewsletter) {
        try {
          const extractId = (val: any) => {
            if (!val || typeof val !== 'string') return "";
            if (val.includes("whatsapp.com/channel/")) return val.split("whatsapp.com/channel/")[1].split("/")[0];
            return val.split("@")[0];
          };

          const chatPart = extractId(chatId);
          const isTarget = targetChannelIds.some(tid => {
            const targetPart = extractId(tid);
            return chatPart === targetPart || chatId === tid;
          });

          if (targetChannelIds.length === 0 || isTarget) {
             const emojis = ["❤️", "🚀", "🔥", "✨", "👍", "👏", "🎉", "💯", "🤩", "🙌", "💥", "⚡", "🌈", "🌟", "💎", "🎯", "🦾", "💪", "🍭", "🍬", "🔥", "🧊"];
             const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
             
             await sleep(1500 + Math.random() * 2000);
             
             await sock.sendMessage(chatId, {
               react: {
                 text: randomEmoji,
                 key: m.key
               }
             });
             console.log(`[AUTO-REACT] Berhasil react ${randomEmoji} di saluran: ${chatId}`);
          }
        } catch (e) {
          console.error(`[AUTO-REACT ERROR]:`, e);
        }
      }

      // Auto-Read Settings - DIBENARKAN LOGIKANYA
 
      const prefix = ".";
      

      // Tebak Bendera Reply Logic
      const tebakbendera = (global as any).tebakbendera;
      if (tebakbendera[chatId] && !body.startsWith(prefix)) {
          const game = tebakbendera[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebakbendera[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebakbendera[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await handleGameWin(m, sock, deviceId, chatId, "tebakbendera", answer);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Gambar Reply Logic
      const tebakgambar = (global as any).tebakgambar;
      if (tebakgambar[chatId] && !body.startsWith(prefix)) {
          const game = tebakgambar[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebakgambar[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebakgambar[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await handleGameWin(m, sock, deviceId, chatId, "tebakgambar", answer);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Lengkapi Kalimat Reply Logic
      const lengkapikalimat = (global as any).lengkapikalimat;
      if (lengkapikalimat[chatId] && !body.startsWith(prefix)) {
          const game = lengkapikalimat[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete lengkapikalimat[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete lengkapikalimat[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Kata Reply Logic
      const tebakkata = (global as any).tebakkata;
      if (tebakkata[chatId] && !body.startsWith(prefix)) {
          const game = tebakkata[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebakkata[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebakkata[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await handleGameWin(m, sock, deviceId, chatId, "tebakkata", answer);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Teka Teki Reply Logic
      const tekateki = (global as any).tekateki;
      if (tekateki[chatId] && !body.startsWith(prefix)) {
          const game = tekateki[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tekateki[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tekateki[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Asah Otak Reply Logic
      const asahotak = (global as any).asahotak;
      if (asahotak[chatId] && !body.startsWith(prefix)) {
          const game = asahotak[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete asahotak[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete asahotak[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Cak Lontong Reply Logic
      const caklontong = (global as any).caklontong;
      if (caklontong[chatId] && !body.startsWith(prefix)) {
          const game = caklontong[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                const desc = game.deskripsi;
                delete caklontong[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n> 📝 Penjelasan: ${desc}\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                const desc = game.deskripsi;
                delete caklontong[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n> 📝 Penjelasan: ${desc}\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Siapakah Aku Reply Logic
      const siapakahaku = (global as any).siapakahaku;
      if (siapakahaku[chatId] && !body.startsWith(prefix)) {
          const game = siapakahaku[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete siapakahaku[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete siapakahaku[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Susun Kata Reply Logic
      const susunkata = (global as any).susunkata;
      if (susunkata[chatId] && !body.startsWith(prefix)) {
          const game = susunkata[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete susunkata[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete susunkata[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Lagu Reply Logic
      const tebaklagu = (global as any).tebaklagu;
      if (tebaklagu[chatId] && !body.startsWith(prefix)) {
          const game = tebaklagu[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebaklagu[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebaklagu[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await handleGameWin(m, sock, deviceId, chatId, "tebaklagu", answer);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Hero ML Reply Logic
      const tebakheroml = (global as any).tebakheroml;
      if (tebakheroml[chatId] && !body.startsWith(prefix)) {
          const game = tebakheroml[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebakheroml[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebakheroml[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Logo Reply Logic
      const tebaklogo = (global as any).tebaklogo;
      if (tebaklogo[chatId] && !body.startsWith(prefix)) {
          const game = tebaklogo[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebaklogo[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebaklogo[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat banget! 🔥🏢`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Game Reply Logic
      const tebakgame = (global as any).tebakgame;
      if (tebakgame[chatId] && !body.startsWith(prefix)) {
          const game = tebakgame[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebakgame[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebakgame[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu gamer sejati! 🔥🎮`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Cerdas Cermat Reply Logic
      const cerdascermat = (global as any).cerdascermat;
      if (cerdascermat[chatId] && !body.startsWith(prefix)) {
          const game = cerdascermat[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             const userAnswer = body.toLowerCase().trim();
             if (userAnswer === 'nyerah') {
                const answer = game.answer;
                delete cerdascermat[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban Benar: *${answer.toUpperCase()}*\n\nBelajar lagi ya dek! 📚`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (userAnswer === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete cerdascermat[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer.toUpperCase()}*\n\nKamu cerdas sekali! 🧠🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (['a', 'b', 'c', 'd'].includes(userAnswer)) {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Tebak Kalimat Reply Logic
      const tebakkalimat = (global as any).tebakkalimat;
      if (tebakkalimat[chatId] && !body.startsWith(prefix)) {
          const game = tebakkalimat[chatId];
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          
          if (quotedId === game.msgId) {
             if (body.toLowerCase() === 'nyerah') {
                const answer = game.answer;
                delete tebakkalimat[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🏳️ *ʏᴀʜʜ ɴʏᴇʀᴀʜ...*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nyahaha cupu👎`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else if (body.toLowerCase() === game.answer.toLowerCase()) {
                const answer = game.answer;
                delete tebakkalimat[chatId];
                if (game.timeout) clearTimeout(game.timeout);
                await sock.sendMessage(chatId, { text: `🎉 *sᴇʟᴀᴍᴀᴛ!* 🏆\n\n> Jawaban kamu benar!\n> ✨ Jawaban: *${answer}*\n\nKamu hebat! 🔥`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
             } else {
                await sock.sendMessage(chatId, { react: { text: "❌", key: m.key } });
             }
             return; 
          }
      }

      // Confess Reply Logic
      const confessData = (global as any).confessData;
      if (confessData && !body.startsWith(prefix)) {
          const quotedId = m.message?.extendedTextMessage?.contextInfo?.stanzaId;
          if (quotedId && confessData.has(quotedId)) {
              const confessInfo = confessData.get(quotedId);
              if (sender === confessInfo.targetJid) {
                  const replyMessage = body.trim();
                  if (replyMessage) {
                      const replyText = 
                          `💌 *ʙᴀʟᴀsᴀɴ ᴅᴀʀɪ ᴏʀᴀɴɢ ʏᴀɴɢ ᴋᴀᴍᴜ ᴄᴏɴꜰᴇss!*\n\n` +
                          `「 📨 *ʙᴀʟᴀsᴀɴ* 」\n` +
                          ` 💕 *ɪsɪ ᴘᴇsᴀɴ:*\n` +
                          `\`\`\`${replyMessage}\`\`\`\n` +
                          `> 🔒 _Identitas tetap dirahasiakan_`;
                      
                      try {
                          await sock.sendMessage(confessInfo.senderChat, {
                              text: replyText,
                              contextInfo: {
                                  ...getContextInfo(deviceConfig, m),
                                  forwardingScore: 9999,
                                  isForwarded: true,
                                  forwardedNewsletterMessageInfo: {
                                      newsletterJid: deviceConfig.channel?.id || '120363426467190619@newsletter',
                                      newsletterName: deviceConfig.channel?.name || 'CMNTY-BOT',
                                      serverMessageId: 1
                                  }
                              }
                          });
                          
                          await sock.sendMessage(chatId, { text: `✅ Balasanmu telah terkirim secara anonim!`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                          confessData.delete(quotedId);
                      } catch (e) {
                          console.error("Confess reply error:", e);
                      }
                      return;
                  }
              }
          }
      }

      // Loop Protection
      if (isFromMe && !body.startsWith(prefix)) continue;

      const actualSender = m.key.participant || m.key.remoteJid || "Unknown";

      if (!body.startsWith(prefix)) continue;

      const args = body.slice(prefix.length).trim().split(/ +/);
      const command = args.shift()?.toLowerCase();
      const q = args.join(" ");

      // Rate Limiting Logic (5 times per minute for non-owners)
      if (!isOwner) {
        const now = Date.now();
        const userTimestamps = rateLimits.get(actualSender) || [];
        const recentTimestamps = userTimestamps.filter(t => now - t < 60000);
        
        if (recentTimestamps.length >= 5) {
          addSystemLog(deviceId, `User ${actualSender} rate limited on command: ${command}`, "warn");
          const waitTimeSec = Math.ceil((60000 - (now - recentTimestamps[0])) / 1000);
          await sock.sendMessage(chatId, {
            text: `⚠️ *ʀᴀᴛᴇ ʟɪᴍɪᴛ*\n\n> Kamu telah mencapai limit penggunaan bot (*5×/menit*).\n> Silakan tunggu *${waitTimeSec} detik* sebelum mencoba lagi.`
          }, { quoted: m });
          continue;
        }
        
        recentTimestamps.push(now);
        rateLimits.set(actualSender, recentTimestamps);
      }

      addSystemLog(deviceId, `User ${actualSender} executed command: ${command}`, "info");

      const reply = async (text: string, mentions: string[] = []) => {
        if (!instance.activeSocket || instance.connectionStatus !== "connected") return;
        try {
          const vQuoted = getVerifiedQuoted(deviceConfig);
          return await sock.sendMessage(m.key.remoteJid!, { 
            text, 
            mentions: Array.isArray(mentions) ? mentions : [], 
            contextInfo: getContextInfo(deviceConfig, m) 
          }, { quoted: vQuoted as any });
        } catch (e: any) {
          if (e.message && e.message.includes("Connection Closed")) return;
          console.error("[REPLY_ERROR]", e.message);
        }
      };

      const send = async (content: any, options: any = {}) => {
        if (!instance.activeSocket || instance.connectionStatus !== "connected") return;
        try {
          if (!content.react && !content.delete && !content.forward) {
            const extraCtx = getContextInfo(deviceConfig, m);
            
            // Merge context info
            const originalCtx = content.contextInfo || {};
            content.contextInfo = {
                ...originalCtx,
                ...extraCtx,
                forwardedNewsletterMessageInfo: extraCtx.forwardedNewsletterMessageInfo,
                forwardingScore: extraCtx.forwardingScore,
                isForwarded: extraCtx.isForwarded
            };

            // Merge externalAdReply if both exist
            if (originalCtx.externalAdReply && extraCtx.externalAdReply) {
                content.contextInfo.externalAdReply = {
                    ...extraCtx.externalAdReply,
                    ...originalCtx.externalAdReply
                };
            }
          }
          
          const vQuoted = getVerifiedQuoted(deviceConfig);
          const finalQuoted = options.quoted || vQuoted;
          
          return await sock.sendMessage(m.key.remoteJid!, content, { quoted: finalQuoted as any, ...options });
        } catch (e: any) {
           if (e.message && e.message.includes("Connection Closed")) return;
           console.error("[SEND_ERROR]", e.message);
        }
      };

      
      const react = async (text: string) => {
        if (!instance.activeSocket || instance.connectionStatus !== "connected") return;
        try {
          return await sock.sendMessage(m.key.remoteJid!, {
            react: { text, key: m.key },
          });
        } catch (e: any) {
          if (e.message && e.message.includes("Connection Closed")) return;
          console.error("[REACT_ERROR]", e.message);
        }
      };

      if (["addowner"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa menggunakan fitur ini!');
        const target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                     m.message?.extendedTextMessage?.contextInfo?.participant ||
                     (q ? q.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
        
        if (!target) return reply(`❌ *ᴘᴇɴɢɢᴜɴᴀᴀɴ sᴀʟᴀʜ*\n\n> Contoh: ${prefix}addowner @user / 628xxx`);
        
        const cleanTarget = target.split('@')[0].split(':')[0] + '@s.whatsapp.net';
        if (deviceConfig.owner.includes(cleanTarget)) return reply('ℹ️ Nomor tersebut sudah menjadi owner.');
        
        if (!deviceConfig.owner) deviceConfig.owner = [];
        deviceConfig.owner.push(cleanTarget);
        // Sync ownerNumber string for UI
        deviceConfig.ownerNumber = deviceConfig.owner.map((o: string) => o.split('@')[0]).join(', ');
        
        fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
        reply(`✅ *ᴏᴡɴᴇʀ ᴅɪᴛᴀᴍʙᴀʜᴋᴀɴ*\n\n> Berhasil menambahkan @${cleanTarget.split('@')[0]} sebagai owner baru!`, [cleanTarget]);
        return;
      }

      if (["delowner"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa menggunakan fitur ini!');
        const target = m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || 
                     m.message?.extendedTextMessage?.contextInfo?.participant ||
                     (q ? q.replace(/[^0-9]/g, "") + "@s.whatsapp.net" : null);
        
        if (!target) return reply(`❌ *ᴘᴇɴɢɢᴜɴᴀᴀɴ sᴀʟᴀʜ*\n\n> Contoh: ${prefix}delowner @user / 628xxx`);
        
        const cleanTarget = target.split('@')[0].split(':')[0] + '@s.whatsapp.net';
        if (!deviceConfig.owner || !deviceConfig.owner.includes(cleanTarget)) return reply('ℹ️ Nomor tersebut bukan owner.');
        
        deviceConfig.owner = deviceConfig.owner.filter((o: string) => o !== cleanTarget);
        // Sync ownerNumber string for UI
        deviceConfig.ownerNumber = deviceConfig.owner.map((o: string) => o.split('@')[0]).join(', ');
        
        fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
        reply(`✅ *ᴏᴡɴᴇʀ ᴅɪʜᴀᴘᴜs*\n\n> Berhasil menghapus @${cleanTarget.split('@')[0]} dari daftar owner!`, [cleanTarget]);
        return;
      }

      if (["listowner"].includes(command || "")) {
        let text = `👑 *ʟɪsᴛ ᴏᴡɴᴇʀ sᴇssɪᴏɴ*\n\n`;
        const owners = deviceConfig.owner || [];
        owners.forEach((o: string, i: number) => {
            text += `${i + 1}. @${o.split('@')[0]}\n`;
        });
        if (owners.length === 0) text += `_Belum ada owner tambahan._\n`;
        text += `\n> *Note:* Nomor bot otomatis menjadi owner.`;
        return reply(text, owners);
      }

      if (["self", "selfmode", "private-mode"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengubah mode bot!');
        if (deviceConfig.botMode === "self") return reply("ℹ️ Bot sudah dalam mode *self*");
        deviceConfig.botMode = "self";
        fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
        reply(`🔒 *ᴍᴏᴅᴇ sᴇʟꜰ ᴀᴋᴛɪꜰ*\n\n> Bot sekarang hanya merespon:\n> • Owner bot\n> • Bot sendiri (fromMe)\n\n_Gunakan ${prefix}public untuk membuka akses_`);
        return;
      }

      if (["public", "publicmode"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengubah mode bot!');
        if (deviceConfig.botMode === "public") return reply("ℹ️ Bot sudah dalam mode *public*");
        deviceConfig.botMode = "public";
        fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
        reply(`🌐 *ᴍᴏᴅᴇ ᴘᴜʙʟɪᴄ ᴀᴋᴛɪꜰ*\n\n> Bot sekarang merespon semua user!\n\n_Gunakan ${prefix}self untuk menutup akses_`);
        return;
      }

      if (["onlygc", "onlygroup", "grouponly"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengubah pengaturan ini!');
        
        if (deviceConfig.onlyGc) {
            deviceConfig.onlyGc = false;
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            await react('❌');
            return reply(`❌ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴍᴏᴅᴇ ɴᴏɴᴀᴋᴛɪꜰ*\n\n> Bot bisa diakses di mana saja`);
        } else {
            deviceConfig.onlyGc = true;
            deviceConfig.onlyPc = false;
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            await react('✅');
            return reply(`✅ *ᴏɴʟʏ ɢʀᴏᴜᴘ ᴍᴏᴅᴇ ᴀᴋᴛɪꜰ*\n\n> Bot hanya bisa diakses di grup!`);
        }
      }

      if (["onlypc", "onlyprivate", "privateonly"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengubah pengaturan ini!');
        
        if (deviceConfig.onlyPc) {
            deviceConfig.onlyPc = false;
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            await react('❌');
            return reply(`❌ *ᴏɴʟʏ ᴘʀɪᴠᴀᴛᴇ ᴍᴏᴅᴇ ɴᴏɴᴀᴋᴛɪꜰ*\n\n> Bot bisa diakses di mana saja`);
        } else {
            deviceConfig.onlyPc = true;
            deviceConfig.onlyGc = false;
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            await react('✅');
            return reply(`✅ *ᴏɴʟʏ ᴘʀɪᴠᴀᴛᴇ ᴍᴏᴅᴇ ᴀᴋᴛɪꜰ*\n\n> Bot hanya bisa diakses di private chat!`);
        }
      }

      if (["onlythisgrup", "onlythisgroup", "lockgrup", "lockgroup"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengubah pengaturan ini!');
        if (!isGroup) return reply('❌ Fitur ini hanya dapat digunakan di dalam grup!');
        
        if (deviceConfig.onlyThisGroup === chatId) {
            deviceConfig.onlyThisGroup = null;
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            return reply(`🔓 *UNLOCKED*\n\nBot aktif di semua grup`);
        }

        deviceConfig.onlyThisGroup = chatId;
        fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));

        const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
        const groupName = groupMetadata?.subject || chatId;

        return reply(
            `🔒 *LOCKED*\n\n` +
            `Bot hanya aktif di:\n` +
            `*${groupName}*\n\n` +
            `Grup lain tidak bisa pakai bot\n` +
            `Ketik ulang untuk unlock`
        );
      }

      if (["autoread"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengubah pengaturan ini!');
        
        const mode = args[0]?.toLowerCase();
        if (mode === 'on') {
           deviceConfig.autoRead = true;
           fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
           await react('✅');
           return reply(`✅ *ᴀᴜᴛᴏʀᴇᴀᴅ ᴅɪᴀᴋᴛɪꜰᴋᴀɴ*\n\n> Bot sekarang akan otomatis menandai pesan sebagai dibaca.`);
        } else if (mode === 'off') {
           deviceConfig.autoRead = false;
           fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
           await react('❌');
           return reply(`❌ *ᴀᴜᴛᴏʀᴇᴀᴅ ᴅɪɴᴏɴᴀᴋᴛɪꜰᴋᴀɴ*\n\n> Bot tidak akan otomatis menandai pesan sebagai dibaca.`);
        } else {
            return reply(`ℹ️ *ᴀᴜᴛᴏʀᴇᴀᴅ sᴇᴛᴛɪɴɢ*\n\n> Gunakan format: \`${prefix}autoread on\` atau \`${prefix}autoread off\`\n\n> Contoh: \`${prefix}autoread on\`\n\n> Status saat ini: *${!!deviceConfig.autoRead ? 'ON' : 'OFF'}*`);
        }
      }

      if (deviceConfig.botMode === "self" && !isOwner) {
        return; // Ignore if in self mode and user is not owner
      }

      if (deviceConfig.onlyGc && !isGroup && !isOwner && !["onlygc", "onlypc", "onlythisgrup"].includes(command || "")) {
        return;
      }

      if (deviceConfig.onlyPc && isGroup && !isOwner && !["onlygc", "onlypc", "onlythisgrup"].includes(command || "")) {
        return;
      }

      if (deviceConfig.onlyThisGroup && isGroup && deviceConfig.onlyThisGroup !== chatId && !isOwner && !["onlygc", "onlypc", "onlythisgrup"].includes(command || "")) {
        return;
      }

      if (!deviceConfig.bannedUsers) {
        deviceConfig.bannedUsers = [];
      }

      if (deviceConfig.bannedUsers.includes(sender) && !isOwner) {
        return; // Ignore if user is banned
      }

      if (["ban", "block"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa memban user!');
        
        let targetList = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        let targetStr = args[0] || (m.message?.extendedTextMessage?.contextInfo?.participant ? [m.message.extendedTextMessage.contextInfo.participant] : []);
        
        if (targetList.length === 0 && Array.isArray(targetStr)) {
            targetList = targetStr;
        } else if (targetList.length === 0 && typeof targetStr === "string" && targetStr) {
            let num = targetStr.replace(/[^0-9]/g, "");
            if (num.startsWith("0")) num = "62" + num.slice(1);
            if (num.startsWith("8")) num = "62" + num;
            targetList = [`${num}@s.whatsapp.net`];
        }

        if (targetList.length === 0) {
            return reply(`✅ *ʙᴀɴ ᴜsᴇʀ*\n\n> Masukkan nomor atau tag user\n\n\`Contoh: ${prefix}ban 6281234567890\``);
        }

        let bannedCount = 0;
        for (const target of targetList) {
            if (!deviceConfig.bannedUsers.includes(target)) {
                deviceConfig.bannedUsers.push(target);
                bannedCount++;
            }
        }

        if (bannedCount > 0) {
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            reply(`✅ *ᴜsᴇʀ ᴅɪʙᴀɴ*\n\n╭┈┈⬡「 📋 *ᴅᴇᴛᴀɪʟ* 」\n┃ ✅ sᴛᴀᴛᴜs: \`Banned\`\n┃ 📊 ᴛᴏᴛᴀʟ: \`${deviceConfig.bannedUsers.length}\` ᴜsᴇʀ\n╰┈┈⬡`);
        } else {
            reply(`❌ *ɢᴀɢᴀʟ*\n\n> User sudah dalam daftar banned`);
        }
        return;
      }

      if (["unban", "delban", "unblock"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa mengunban user!');
        
        let targetList = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        let targetStr = args[0] || (m.message?.extendedTextMessage?.contextInfo?.participant ? [m.message.extendedTextMessage.contextInfo.participant] : []);
        
        if (targetList.length === 0 && Array.isArray(targetStr)) {
            targetList = targetStr;
        } else if (targetList.length === 0 && typeof targetStr === "string" && targetStr) {
            let num = targetStr.replace(/[^0-9]/g, "");
            if (num.startsWith("0")) num = "62" + num.slice(1);
            if (num.startsWith("8")) num = "62" + num;
            targetList = [`${num}@s.whatsapp.net`];
        }

        if (targetList.length === 0) {
            return reply(`✅ *ᴜɴʙᴀɴ ᴜsᴇʀ*\n\n> Masukkan nomor atau tag user\n\n\`Contoh: ${prefix}unban 6281234567890\``);
        }

        let unbannedCount = 0;
        for (const target of targetList) {
            const index = deviceConfig.bannedUsers.indexOf(target);
            if (index !== -1) {
                deviceConfig.bannedUsers.splice(index, 1);
                unbannedCount++;
            }
        }

        if (unbannedCount > 0) {
            fs.writeFileSync(path.join(sessionsDir, deviceId, "config.json"), JSON.stringify(deviceConfig, null, 2));
            await react("✅");
            reply(`✅ *ᴜsᴇʀ ᴅɪᴜɴʙᴀɴ*\n\n╭┈┈⬡「 📋 *ᴅᴇᴛᴀɪʟ* 」\n┃ 📱 ɴᴏᴍᴏʀ: \`${targetList[0].split('@')[0]}\`\n┃ ✅ sᴛᴀᴛᴜs: \`Unbanned\`\n┃ 📊 ᴛᴏᴛᴀʟ: \`${deviceConfig.bannedUsers.length}\` ᴜsᴇʀ\n╰┈┈⬡`);
        } else {
            reply(`❌ *ɢᴀɢᴀʟ*\n\n> Nomor \`${targetList[0]?.split('@')[0] || args[0]}\` tidak dalam daftar banned`);
        }
        return;
      }

      if (["listban", "listbanned", "banlist"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa melihat daftar banned!');
        
        const bannedUsers = deviceConfig.bannedUsers || [];
        
        if (bannedUsers.length === 0) {
            return reply(`🚫 *ʟɪsᴛ ʙᴀɴɴᴇᴅ*\n\n> Tidak ada user yang dibanned\n\n\`Gunakan: ${prefix}ban <nomor>\``);
        }
        
        let caption = `🚫 *ʟɪsᴛ ʙᴀɴɴᴇᴅ*\n\n`;
        caption += `╭┈┈⬡「 ⛔ *ᴜsᴇʀs* 」\n`;
        
        for (let i = 0; i < bannedUsers.length; i++) {
            caption += `┃ ${i + 1}. \`@${bannedUsers[i].split('@')[0]}\`\n`;
        }
        
        caption += `╰┈┈⬡\n\n`;
        caption += `> ᴛᴏᴛᴀʟ: \`${bannedUsers.length}\` ʙᴀɴɴᴇᴅ ᴜsᴇʀ`;
        
        const ctx: any = getContextInfo(deviceConfig, m);
        ctx.mentionedJid = bannedUsers;

        await sock.sendMessage(m.key.remoteJid!, {
           text: caption,
           contextInfo: ctx
        }, { quoted: m });
        return;
      }


    if (command === "tebakbendera") {
        const tebakbendera = (global as any).tebakbendera;
        if (tebakbendera[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebakbendera");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { name, img } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ʙᴇɴᴅᴇʀᴀ*\n\n> Tebaklah nama negara dari bendera di atas!\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                image: { url: img },
                caption: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            tebakbendera[chatId] = {
                answer: name,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tebakbendera[chatId] && tebakbendera[chatId].msgId === msgId) {
                        const answer = tebakbendera[chatId].answer;
                        delete tebakbendera[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "tebakgambar") {
        const tebakgambar = (global as any).tebakgambar;
        if (tebakgambar[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebakgambar");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { jawaban, img, deskripsi } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ɢᴀᴍʙᴀʀ*\n\n> Tebaklah maksud dari gambar di atas!\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                image: { url: img },
                caption: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            tebakgambar[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tebakgambar[chatId] && tebakgambar[chatId].msgId === msgId) {
                        const answer = tebakgambar[chatId].answer;
                        delete tebakgambar[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "lengkapikalimat") {
        const lengkapikalimat = (global as any).lengkapikalimat;
        if (lengkapikalimat[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/lengkapikalimat");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { pertanyaan, jawaban } = res.data.data;
            const caption = `🎮 *ʟᴇɴɢᴋᴀᴘɪ ᴋᴀʟɪᴍᴀᴛ*\n\n> *Pertanyaan:* ${pertanyaan}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            lengkapikalimat[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (lengkapikalimat[chatId] && lengkapikalimat[chatId].msgId === msgId) {
                        const answer = lengkapikalimat[chatId].answer;
                        delete lengkapikalimat[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "tebakkata") {
        const tebakkata = (global as any).tebakkata;
        if (tebakkata[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebakkata");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, jawaban } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ᴋᴀᴛᴀ*\n\n> *Petunjuk:* ${soal}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            tebakkata[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tebakkata[chatId] && tebakkata[chatId].msgId === msgId) {
                        const answer = tebakkata[chatId].answer;
                        delete tebakkata[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "asahotak") {
        const asahotak = (global as any).asahotak;
        if (asahotak[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/asahotak");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, jawaban } = res.data.data;
            const caption = `🎮 *ᴀsᴀʜ ᴏᴛᴀᴋ*\n\n> *Soal:* ${soal}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            asahotak[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (asahotak[chatId] && asahotak[chatId].msgId === msgId) {
                        const answer = asahotak[chatId].answer;
                        delete asahotak[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "caklontong") {
        const caklontong = (global as any).caklontong;
        if (caklontong[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/caklontong");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, jawaban, deskripsi } = res.data.data;
            const caption = `🎮 *ᴄᴀᴋ ʟᴏɴᴛᴏɴɢ*\n\n> *Pertanyaan:* ${soal}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            caklontong[chatId] = {
                answer: jawaban,
                deskripsi: deskripsi,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (caklontong[chatId] && caklontong[chatId].msgId === msgId) {
                        const answer = caklontong[chatId].answer;
                        const desc = caklontong[chatId].deskripsi;
                        delete caklontong[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n> 📝 Penjelasan: ${desc}\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "siapakahaku") {
        const siapakahaku = (global as any).siapakahaku;
        if (siapakahaku[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/siapakahaku");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, jawaban } = res.data.data;
            const caption = `🎮 *sɪᴀᴘᴀᴋᴀʜ ᴀᴋᴜ*\n\n> *Soal:* ${soal}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            siapakahaku[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (siapakahaku[chatId] && siapakahaku[chatId].msgId === msgId) {
                        const answer = siapakahaku[chatId].answer;
                        delete siapakahaku[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "susunkata") {
        const susunkata = (global as any).susunkata;
        if (susunkata[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/susunkata");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, tipe, jawaban } = res.data.data;
            const caption = `🎮 *sᴜsᴜɴ ᴋᴀᴛᴀ*\n\n> *Soal:* ${soal}\n> *Tipe:* ${tipe}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            susunkata[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (susunkata[chatId] && susunkata[chatId].msgId === msgId) {
                        const answer = susunkata[chatId].answer;
                        delete susunkata[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "tebaklagu") {
        const tebaklagu = (global as any).tebaklagu;
        if (tebaklagu[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebaklagu");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { lagu, judul, artis } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ʟᴀɢᴜ*\n\n> Tebaklah judul lagu dari potongan audio di atas!\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ 🎤 Artis: ${artis}\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu dengan membalas pesan ini!_`;
            
            const sentAudio = await sock.sendMessage(chatId, {
                audio: { url: lagu },
                mimetype: 'audio/mpeg',
                ptt: true,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });

            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: sentAudio! });
            
            const msgId = sentMsg!.key.id;
            const expiry = Date.now() + 60000;
            
            tebaklagu[chatId] = {
                answer: judul,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tebaklagu[chatId] && tebaklagu[chatId].msgId === msgId) {
                        const answer = tebaklagu[chatId].answer;
                        delete tebaklagu[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "tebakheroml") {
        const tebakheroml = (global as any).tebakheroml;
        if (tebakheroml[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebakheroml");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { name, audio } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ʜᴇʀᴏ ᴍʟ*\n\n> Tebaklah nama hero Mobile Legends dari suara/voice line di atas!\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu dengan membalas pesan ini!_`;
            
            const sentAudio = await sock.sendMessage(chatId, {
                audio: { url: audio },
                mimetype: 'audio/mpeg',
                ptt: true,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });

            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: sentAudio! });
            
            const msgId = sentMsg!.key.id;
            const expiry = Date.now() + 60000;
            
            tebakheroml[chatId] = {
                answer: name,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tebakheroml[chatId] && tebakheroml[chatId].msgId === msgId) {
                        const answer = tebakheroml[chatId].answer;
                        delete tebakheroml[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "tebaklogo") {
        const tebaklogo = (global as any).tebaklogo;
        if (tebaklogo[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebaklogo");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { image, jawaban } = res.data.data.data;
            const caption = `🏢 *ᴛᴇʙᴀᴋ ʟᴏɢᴏ*\n\n> Tebaklah nama brand/aplikasi pada logo di atas!\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu dengan membalas pesan ini!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                image: { url: image },
                caption: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg!.key.id;
            
            tebaklogo[chatId] = {
                answer: jawaban,
                msgId: msgId,
                timeout: setTimeout(async () => {
                    if (tebaklogo[chatId] && tebaklogo[chatId].msgId === msgId) {
                        const answer = tebaklogo[chatId].answer;
                        delete tebaklogo[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game tebak logo.");
        }
        return;
    }

    if (command === "tebakgame") {
        const tebakgame = (global as any).tebakgame;
        if (tebakgame[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebakgame");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { img, jawaban } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ɢᴀᴍᴇ*\n\n> Tebaklah judul game pada gambar di atas!\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu dengan membalas pesan ini!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                image: { url: img },
                caption: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg!.key.id;
            
            tebakgame[chatId] = {
                answer: jawaban,
                msgId: msgId,
                timeout: setTimeout(async () => {
                    if (tebakgame[chatId] && tebakgame[chatId].msgId === msgId) {
                        const answer = tebakgame[chatId].answer;
                        delete tebakgame[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game tebak game.");
        }
        return;
    }

    if (command === "cerdascermat") {
        const cerdascermat = (global as any).cerdascermat;
        if (cerdascermat[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/cc-sd?matapelajaran=matematika&jumlahsoal=1");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const soalData = res.data.data.soal[0];
            const { pertanyaan, semua_jawaban, jawaban_benar } = soalData;
            
            let options = "";
            semua_jawaban.forEach((obj: any) => {
                const key = Object.keys(obj)[0];
                options += `┃ ${key.toUpperCase()}. ${obj[key]}\n`;
            });

            const caption = `🎓 *ᴄᴇʀᴅᴀs ᴄᴇʀᴍᴀᴛ (sᴅ)*\n\n> Jawablah pertanyaan di bawah ini dengan benar!\n\n📝 *Pertanyaan:* \n${pertanyaan}\n\n╭┈┈⬡「 📋 *ᴘɪʟɪʜᴀɴ* 」\n${options}╰┈┈┈┈┈┈┈┈⬡\n\n╭┈┈⬡「 ℹ️ *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu (a/b/c/d) dengan membalas pesan ini!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg!.key.id;
            
            cerdascermat[chatId] = {
                answer: jawaban_benar,
                msgId: msgId,
                timeout: setTimeout(async () => {
                    if (cerdascermat[chatId] && cerdascermat[chatId].msgId === msgId) {
                        const answer = cerdascermat[chatId].answer;
                        delete cerdascermat[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban Benar: *${answer.toUpperCase()}*\n\nJangan menyerah, coba lagi! 💪`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game cerdas cermat.");
        }
        return;
    }

    if (command === "tebakkalimat") {
        const tebakkalimat = (global as any).tebakkalimat;
        if (tebakkalimat[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tebakkalimat");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, jawaban } = res.data.data;
            const caption = `🎮 *ᴛᴇʙᴀᴋ ᴋᴀʟɪᴍᴀᴛ*\n\n> Lengkapilah kalimat rumpang di bawah ini!\n\n📝 *Soal:* ${soal}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu dengan membalas pesan ini!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg!.key.id;
            const expiry = Date.now() + 60000;
            
            tebakkalimat[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tebakkalimat[chatId] && tebakkalimat[chatId].msgId === msgId) {
                        const answer = tebakkalimat[chatId].answer;
                        delete tebakkalimat[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    if (command === "tekateki") {
        const tekateki = (global as any).tekateki;
        if (tekateki[chatId]) return reply("❌ Masih ada game yang berlangsung di grup ini!");
        
        try {
            const res = await axios.get("https://api.siputzx.my.id/api/games/tekateki");
            if (!res.data.status) return reply("❌ Gagal mengambil data game. Coba lagi nanti.");
            
            const { soal, jawaban } = res.data.data;
            const caption = `🎮 *ᴛᴇᴋᴀ ᴛᴇᴋɪ*\n\n> *Pertanyaan:* ${soal}\n\n╭┈┈⬡「 📋 *ɪɴғᴏ* 」\n┃ ⏲️ Waktu: \`60 Detik\`\n┃ 🏳️ Ketik *nyerah* reply pesannya untuk menyerah\n╰┈┈┈┈┈┈┈┈⬡\n\n> _Kirim jawaban kamu sekarang!_`;
            
            const sentMsg = await sock.sendMessage(chatId, {
                text: caption,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            const msgId = sentMsg.key.id;
            const expiry = Date.now() + 60000;
            
            tekateki[chatId] = {
                answer: jawaban,
                msgId: msgId,
                expiry: expiry,
                timeout: setTimeout(async () => {
                    if (tekateki[chatId] && tekateki[chatId].msgId === msgId) {
                        const answer = tekateki[chatId].answer;
                        delete tekateki[chatId];
                        await sock.sendMessage(chatId, { text: `⏲️ *ᴡᴀᴋᴛᴜ ʜᴀʙɪs!*\n\n> Game berakhir.\n> ✨ Jawaban tadi: *${answer}*\n\nCoba lagi lain kali! 😅`, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
                    }
                }, 60000)
            };
        } catch (e) {
            reply("❌ Terjadi kesalahan saat memulai game.");
        }
        return;
    }

    // --- GROUP COMMANDS ---
    if (command === "open") {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isBotAdmin) return reply("❌ Saya harus jadi admin untuk menggunakan fitur ini!");
        if (!isAdmin) return reply("❌ Hanya admin yang dapat menggunakan fitur ini!");
        
        try {
            await sock.groupSettingUpdate(chatId, 'not_announcement');
            await sock.sendMessage(chatId, { 
                text: "🔓 *Gʀᴜᴘ ᴛᴇʟᴀʜ ᴅɪʙᴜᴋᴀ!*\n\n> Sekarang semua anggota grup dapat mengirim pesan.",
                contextInfo: { 
                    ...getContextInfo(deviceConfig, m),
                    forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (e) {
            reply("❌ Terjadi kesalahan saat membuka grup.");
        }
        return;
    }

    if (command === "close") {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isBotAdmin) return reply("❌ Saya harus jadi admin untuk menggunakan fitur ini!");
        if (!isAdmin) return reply("❌ Hanya admin yang dapat menggunakan fitur ini!");
        
        try {
            await sock.groupSettingUpdate(chatId, 'announcement');
            await sock.sendMessage(chatId, { 
                text: "🔒 *Gʀᴜᴘ ᴛᴇʟᴀʜ ᴅɪᴛᴜᴛᴜᴘ!*\n\n> Sekarang hanya admin yang dapat mengirim pesan.",
                contextInfo: { 
                    ...getContextInfo(deviceConfig, m),
                    forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (e) {
            reply("❌ Terjadi kesalahan saat menutup grup.");
        }
        return;
    }

    if (["kick", "dor"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isBotAdmin) return reply("❌ Saya harus jadi admin untuk menggunakan fitur ini!");
        if (!isAdmin) return reply("❌ Hanya admin yang dapat menggunakan fitur ini!");

        const mentionedJid = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetUser = m.message?.extendedTextMessage?.contextInfo?.participant || mentionedJid[0] || m.quoted?.sender;
        if (!targetUser) return reply("❌ Tag atau balas pesan member yang ingin dikeluarkan!");

        try {
            const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
            const participant = groupMetadata?.participants.find(p => p.id === targetUser);
            // participant?.notifyName is what we want for the name instead of numerical ID.
            // If the user wants @user, we can use the JID or just mention them.
            // Let's use the JID in mentions for the automatic tagging feature of WA and show @number in the text.
            const displayName = participant?.notifyName || targetUser.split('@')[0];

            await sock.groupParticipantsUpdate(chatId, [targetUser], 'remove');
            await sock.sendMessage(chatId, {
                text: `✅ *Berhasil*\n\n> Menendang @${displayName} dari grup!`,
                mentions: [targetUser],
                contextInfo: { 
                    ...getContextInfo(deviceConfig, m),
                    forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (e) {
            console.error("[Kick Error]:", e);
            reply("❌ Terjadi kesalahan saat mengeluarkan member.");
        }
        return;
    }

    if (command === "promote") {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isBotAdmin) return reply("❌ Saya harus jadi admin untuk menggunakan fitur ini!");
        if (!isAdmin) return reply("❌ Hanya admin yang dapat menggunakan fitur ini!");

        const mentionedJid = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetUser = m.message?.extendedTextMessage?.contextInfo?.participant || mentionedJid[0] || m.quoted?.sender;
        if (!targetUser) return reply("❌ Tag atau balas pesan member yang ingin dijadikan admin!");

        try {
            await sock.groupParticipantsUpdate(chatId, [targetUser], 'promote');
            await sock.sendMessage(chatId, {
                text: `👑 *PROMOTE SUCCESS*\n\n> Berhasil mempromosikan @${targetUser.split('@')[0]} menjadi admin grup!`,
                mentions: [targetUser],
                contextInfo: { 
                    ...getContextInfo(deviceConfig, m),
                    forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (e) {
            console.error("[Promote Error]:", e);
            reply("❌ Gagal mempromosikan member.");
        }
        return;
    }

    if (command === "demote") {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isBotAdmin) return reply("❌ Saya harus jadi admin untuk menggunakan fitur ini!");
        if (!isAdmin) return reply("❌ Hanya admin yang dapat menggunakan fitur ini!");

        const mentionedJid = m.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        const targetUser = m.message?.extendedTextMessage?.contextInfo?.participant || mentionedJid[0] || m.quoted?.sender;
        if (!targetUser) return reply("❌ Tag atau balas pesan admin yang ingin diberhentikan!");

        try {
            await sock.groupParticipantsUpdate(chatId, [targetUser], 'demote');
            await sock.sendMessage(chatId, {
                text: `🛡️ *DEMOTE SUCCESS*\n\n> Berhasil memberhentikan @${targetUser.split('@')[0]} dari admin grup!`,
                mentions: [targetUser],
                contextInfo: { 
                    ...getContextInfo(deviceConfig, m),
                    forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (e) {
            console.error("[Demote Error]:", e);
            reply("❌ Gagal memberhentikan member.");
        }
        return;
    }

    if (command === "afk") {
        const reason = q || "Tanpa alasan";
        (global as any).afk[sender] = {
            reason: reason,
            time: Date.now()
        };
        await sock.sendMessage(chatId, { 
            text: `💤 *See you more*\n\n> @${sender.split('@')[0]} sekarang sedang AFK.\n> 📝 *Aʟᴀsᴀɴ:* ${reason}\n\nKetik apa saja untuk kembali!`,
            mentions: [sender],
            contextInfo: { 
                ...getContextInfo(deviceConfig, m),
                forwardedNewsletterMessageInfo: forwardedNewsletterMessageInfo
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
    }

    const absensi = (global as any).absensi;

    if (command === "absen" || command === "hadir") {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!absensi[chatId]) {
            return reply(
                `❌ *ᴛɪᴅᴀᴋ ᴀᴅᴀ ᴀʙsᴇɴ*\n\n` +
                `> Belum ada sesi absen di grup ini!\n\n` +
                `> Admin dapat memulai dengan\n` +
                `> *.mulaiabsen [keterangan]*`
            );
        }
        const absen = absensi[chatId];
        if (absen.peserta.includes(sender)) {
            return reply(`❌ Kamu sudah absen!`);
        }
        absen.peserta.push(sender);
        const now = moment().tz('Asia/Jakarta');
        const dateStr = now.format('D MMMM YYYY');
        const list = absen.peserta
            .map((jid: string, i: number) => `┃ ${i + 1}. @${jid.split('@')[0]}`)
            .join('\n');
        
        await sock.sendMessage(chatId, {
            text: `✅ *MANTAP, @${sender.split('@')[0]} HADIRR*\n` +
                `TUJUAN ABSEN: ${absen.keterangan}\n` +
                `╭┈┈⬡「 📋 INFO LAIN 」\n` +
                `┃ 📅 ${dateStr}\n` +
                `┃ 👥 Total: ${absen.peserta.length}\n` +
                `├┈┈⬡「 📝 *ᴅᴀғᴛᴀʀ ʜᴀᴅɪʀ* 」\n` +
                `${list}\n` +
                `╰┈┈┈┈┈┈┈┈⬡\n\n` +
                `> _Ketik *${prefix}absen* untuk hadir_\n` +
                `> _Ketik *${prefix}cekabsen* untuk melihat daftar_`,
            contextInfo: {
                mentionedJid: [...absen.peserta, sender],
                ...(getContextInfo(deviceConfig, m, null, true, true).contextInfo as any)
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
    }

    if (["mulaiabsen", "startabsen", "bukaabsen", "openabsen"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini khusus Admin grup!");
        
        if (absensi[chatId]) {
            return reply(
                `❌ *ᴍᴀsɪʜ ᴀᴅᴀ ᴀʙsᴇɴ*\n\n` +
                `> Masih ada sesi absen di grup ini!\n\n` +
                `> Ketik *.hapusabsen* untuk menghapus\n` +
                `> atau *.cekabsen* untuk melihat daftar`
            );
        }
        
        const keterangan = q || 'Absen Harian';
        
        absensi[chatId] = {
            keterangan: keterangan,
            createdBy: sender,
            createdAt: new Date().toISOString(),
            peserta: []
        };
        
        await sock.sendMessage(chatId, {
            text: `📋 *ABSEN UDAH JALAN NIHH*\n\n` +
                `「 📋 *ɪɴғᴏ* 」\n` +
                `📝 ${keterangan}\n` +
                `👑 Dibuat oleh: @${sender.split('@')[0]}\n` +
                `👥 Peserta: 0\n\n` +
                `Untuk kamu yang mau ikutan absen, silahkan ketik *${prefix}absen*\n` +
                `Untuk admin yang mau cek absen, silahkan ketik *${prefix}cekabsen*\n` +
                `Untuk admin yang mau hapus absen, silahkan ketik *${prefix}hapusabsen*`,
            contextInfo: {
                mentionedJid: [sender],
                ...(getContextInfo(deviceConfig, m, null, true, true).contextInfo as any)
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
    }

    if (["cekabsen", "listabsen", "daftarabsen", "lihathadir"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!absensi[chatId]) {
            return reply(
                `❌ *ᴛɪᴅᴀᴋ ᴀᴅᴀ ᴀʙsᴇɴ*\n\n` +
                `> Belum ada sesi absen di grup ini!\n\n` +
                `> Admin dapat memulai dengan\n` +
                `> *.mulaiabsen [keterangan]*`
            );
        }
        const absen = absensi[chatId];
        const now = moment().tz('Asia/Jakarta');
        const dateStr = now.format('D MMMM YYYY');
        const createdDate = moment(absen.createdAt).tz('Asia/Jakarta');
        const timeStr = createdDate.format('HH:mm');
        let list = '┃ _Belum ada yang absen_';
        if (absen.peserta.length > 0) {
            list = absen.peserta
                .map((jid: string, i: number) => `┃ ${i + 1}. @${jid.split('@')[0]}`)
                .join('\n');
        }
        
        await sock.sendMessage(chatId, {
            text: `📋 *DAFTAR YANG UDAH ABSEN*\n\n` +
                `╭┈┈⬡「 📋 *INFO* 」\n` +
                `┃ 📝 ${absen.keterangan}\n` +
                `┃ 📅 ${dateStr}\n` +
                `┃ ⏰ Dimulai: ${timeStr}\n` +
                `┃ 👑 Dibuat: @${absen.createdBy.split('@')[0]}\n` +
                `├┈┈⬡「 👥 *PESERTA (${absen.peserta.length})* 」\n` +
                `${list}\n` +
                `╰┈┈┈┈┈┈┈┈⬡\n\n` +
                `Ketik *${prefix}absen* untuk hadir`,
            contextInfo: {
                mentionedJid: [...absen.peserta, absen.createdBy],
                ...(getContextInfo(deviceConfig, m, null, true, true).contextInfo as any)
            }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
    }

    if (["hapusabsen", "deleteabsen", "tutupabsen", "closeabsen", "resetabsen"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini khusus Admin grup!");
        
        if (!absensi[chatId]) {
            return reply(
                `❌ *ᴛɪᴅᴀᴋ ᴀᴅᴀ ᴀʙsᴇɴ*\n\n` +
                `> Tidak ada sesi absen di grup ini!`
            );
        }
        
        const absen = absensi[chatId];
        const totalPeserta = absen.peserta.length;
        
        delete absensi[chatId];
        
        await reply(
            `✅ *ABSEN DITUTUP!*\n\n` +
            `Hasil Akhir:\n` +
            `📝 ${absen.keterangan}\n` +
            `👥 Total hadir: ${totalPeserta}\n\n` +
            `Sesi absen telah dihapus.`
        );
        return;
    }


    // --- NEWS COMMANDS ---
    const NEWS_SOURCES: any = {
        antara: { url: 'https://www.antaranews.com/rss/terkini.xml', name: 'Antara News', emoji: '📰' },
        cnn: { url: 'https://www.cnnindonesia.com/nasional/rss', name: 'CNN Indonesia', emoji: '📺' },
        cnbc: { url: 'https://www.cnbcindonesia.com/rss', name: 'CNBC Indonesia', emoji: '💹' },
        sindonews: { url: 'https://international.sindonews.com/rss', name: 'Sindo News', emoji: '📰' },
    };

    // --- MOBILE LEGENDS COMMANDS ---
    if (command === "buildml") {
        if (!q) return reply(`📚 *BUILD ML*\n\n> Masukan nama karakter\n\nContoh: ${prefix}buildml gusion`);
        
        await react("🕕");
        try {
            const { data } = await axios.get(
                `https://api.apocalypse.web.id/search/buildml?hero=${encodeURIComponent(q)}`
            );

            const heroes = data.builds;
            if (!heroes || !heroes.length) {
                await react("❌");
                return reply("❌ Build tidak ditemukan");
            }

            const pickRandom = heroes[Math.floor(Math.random() * heroes.length)];
            const title = pickRandom.title;

            const itemnya = pickRandom.items?.map((v: any) => {
                return `*ITEM NYA*
🌿 \`Nama\`: ${v.name}
🔮 \`Tipe\`: ${v.type}
💵 \`Harga\`: ${v.price}

*STATS*
🚧 \`Magic Power\`: ${v.stats?.magic_power || "-"}
👻 \`Movement Speed\`: ${v.stats?.movement_speed || "-"}
🎗️ \`Magic Penetration\`: ${v.stats?.magic_penetration || "-"}

*PASSIVE*
${v.passive_description || "-"}`;
            }).join("\n\n");

            await sock.sendMessage(chatId, {
                text: `*BUILD ${q.toUpperCase()}*\n\n🍯 *Title*\n${title}\n\n${itemnya}`,
                contextInfo: {
                    ...(getContextInfo(deviceConfig, m, null, true, true).contextInfo as any)
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            await react("🎮");
        } catch (error) {
            console.error('BuildML Error:', error);
            await react("❌");
            return reply(`❌ Gagal mengambil data build. Silakan coba lagi nanti.`);
        }
        return;
    }

    // --- MOBILE LEGENDS TOURNAMENT COMMANDS ---
    if (["infotourney", "tourney", "turnamen", "mltourney"].includes(command || "")) {
        await react('🕕');
        try {
            const url = 'https://infotourney.com/tournament/mobile-legends';
            const { data } = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 15000
            });
            const $ = cheerio.load(data);
            const tournaments: any[] = [];

            $('.items-row .item').each((_: any, element: any) => {
                const item = $(element);
                const title = item.find('h2[itemprop="name"] a').text().trim();
                const link = item.find('h2[itemprop="name"] a').attr('href');
                const image = item.find('p img').attr('src');
                let datePublished = item.find('time[itemprop="datePublished"]').attr('datetime');

                if (datePublished) {
                    datePublished = moment(datePublished).tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm');
                }

                const descriptionHtml = item.find('p[style="text-align: center;"]').html() || "";
                const [rawDescription, rawInfo] = descriptionHtml.split('<br>').map((text: string) => text.trim());

                const description = rawDescription ? rawDescription.replace(/&nbsp;/g, ' ') : "";
                const info = rawInfo ? rawInfo.replace(/&nbsp;/g, ' ') : "";

                if (title && link) {
                    tournaments.push({
                        title,
                        imageUrl: new URL(image || "", url).href,
                        datePublished,
                        description,
                        info,
                        url: new URL(link, url).href
                    });
                }
            });

            if (tournaments.length === 0) {
                await react('❌');
                return reply('❌ Tidak ada turnamen yang ditemukan');
            }

            const saluranId = deviceConfig.saluran?.id || '120363426467190619@newsletter';
            const saluranName = deviceConfig.saluran?.name || deviceConfig.bot?.name || 'CMNTY-BOT';

            let text = `🏆 *ɪɴꜰᴏ ᴛᴜʀɴᴀᴍᴇɴ ᴍᴏʙɪʟᴇ ʟᴇɢᴇɴᴅs*\n\n`;
            text += `> 5 Turnamen Terbaru\n\n`;

            for (let i = 0; i < Math.min(tournaments.length, 5); i++) {
                const t = tournaments[i];
                text += `${i + 1}. *${t.title}*\n`;
                text += `📅 ${t.datePublished || 'N/A'}\n`;
                if (t.description) text += `📝 ${t.description}\n`;
                if (t.info) text += `⚠️ ${t.info}\n`;
                text += `🔗 ${t.url}\n\n`;
            }

            const firstImage = tournaments[0]?.imageUrl;

            if (firstImage && firstImage.startsWith('http')) {
                await sock.sendMessage(chatId, {
                    image: { url: firstImage },
                    caption: text,
                    contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 127
                        },
                        ...(getContextInfo(deviceConfig, m, null, true, true).contextInfo as any)
                    }
                }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            } else {
                await reply(text);
            }

            await react('✅');
        } catch (error) {
            console.error('InfoTourney Error:', error);
            await react('☢');
            return reply(`❌ Gagal mengambil info turnamen. Silakan coba lagi nanti.`);
        }
        return;
    }


    // --- BLUE ARCHIVE COMMANDS ---
    if (["bluearchive-char", "bachar", "ba"].includes(command || "")) {
        if (!q) {
            return reply(
                `🎮 *ʙʟᴜᴇ ᴀʀᴄʜɪᴠᴇ ᴄʜᴀʀᴀᴄᴛᴇʀ*\n\n` +
                `> Lihat info character Blue Archive\n\n` +
                `> *Contoh:*\n` +
                `> ${prefix}bluearchive-char shiroko\n` +
                `> ${prefix}bachar hoshino\n` +
                `> ${prefix}ba aru`
            );
        }

        await react('🕕');

        try {
            const findUrl = (input: string, urls: string[]) => {
                const clean = input.toLowerCase().replace(/\s+/g, '_');
                if (urls.includes(clean)) return clean;
                const words = clean.split('_');
                const matches = urls.filter(url => words.every(word => url.toLowerCase().includes(word)));
                return matches.length > 0 ? matches[0] : null;
            };

            const { data: listData } = await axios.get('https://api.dotgg.gg/bluearchive/characters');
            const urls = listData.map((c: any) => c.url);
            const foundUrl = findUrl(q, urls);

            if (!foundUrl) {
                const suggestions = urls.filter((u: string) => u.includes(q.toLowerCase().split(' ')[0])).slice(0, 5);
                await react("❌");
                return reply(`Character "${q}" tidak ditemukan.\n\n> Mungkin maksud: ${suggestions.join(', ') || 'tidak ada'}`);
            }

            const { data: char } = await axios.get(`https://api.dotgg.gg/bluearchive/characters/${foundUrl}`);
            const fullChar = {
                ...char,
                img: char.img ? 'https://images.dotgg.gg/bluearchive/characters/' + char.img : null
            };

            const saluranId = deviceConfig.saluran?.id || '120363426467190619@newsletter';
            const saluranName = deviceConfig.saluran?.name || deviceConfig.bot?.name || 'CMNTY-BOT';

            let caption = `🎮 *${fullChar.name?.toUpperCase()}*\n\n`;
            if (fullChar.bio) caption += `> ${fullChar.bio.substring(0, 200)}${fullChar.bio.length > 200 ? '...' : ''}\n\n`;

            caption += `╭┈┈⬡「 📋 *ᴘʀᴏꜰɪʟᴇ* 」\n`;
            if (fullChar.profile?.familyName) caption += `┃ 👤 Family: *${fullChar.profile.familyName}*\n`;
            if (fullChar.profile?.age) caption += `┃ 🎂 Age: *${fullChar.profile.age}*\n`;
            if (fullChar.profile?.height) caption += `┃ 📏 Height: *${fullChar.profile.height}*\n`;
            if (fullChar.profile?.school) caption += `┃ 🏫 School: *${fullChar.profile.school}*\n`;
            if (fullChar.profile?.club) caption += `┃ 🎯 Club: *${fullChar.profile.club}*\n`;
            if (fullChar.profile?.hobby) caption += `┃ ⭐ Hobby: *${fullChar.profile.hobby}*\n`;
            if (fullChar.profile?.CV) caption += `┃ 🎤 CV: *${fullChar.profile.CV}*\n`;
            caption += `╰┈┈┈┈┈┈┈┈⬡\n\n`;

            caption += `╭┈┈⬡「 ⚔️ *ʙᴀᴛᴛʟᴇ* 」\n`;
            if (fullChar.type) caption += `┃ 🏷️ Type: *${fullChar.type}*\n`;
            if (fullChar.role) caption += `┃ 🎭 Role: *${fullChar.role}*\n`;
            if (fullChar.position) caption += `┃ 📍 Position: *${fullChar.position}*\n`;
            if (fullChar.profile?.weaponType) caption += `┃ 🔫 Weapon: *${fullChar.profile.weaponType}*\n`;
            if (fullChar.profile?.weaponName) caption += `┃ ⚔️ Weapon Name: *${fullChar.profile.weaponName}*\n`;
            caption += `╰┈┈┈┈┈┈┈┈⬡\n\n`;

            if (fullChar.skills && fullChar.skills.length > 0) {
                caption += `╭┈┈⬡「 ✨ *sᴋɪʟʟs* 」\n`;
                for (const skill of fullChar.skills.slice(0, 4)) {
                    caption += `┃ 🔹 *${skill.name}* (${skill.type})\n`;
                }
                caption += `╰┈┈┈┈┈┈┈┈⬡`;
            }

            if (fullChar.img) {
                await sock.sendMessage(chatId, {
                    image: { url: fullChar.img },
                    caption,
                    contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 127
                        },
                        ...(getContextInfo(deviceConfig, m, null, true, true).contextInfo as any)
                    }
                }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            } else {
                await reply(caption);
            }

            await react('✅');
        } catch (error: any) {
            console.error('BlueArchive Error:', error);
            await react('☢');
            return reply(`❌ Error: ${error.message || 'Terjadi kesalahan'}`);
        }
        return;
    }


    if (["antara", "cnn", "cnbc", "sindonews", "berita"].includes(command || "")) {
        let source = command?.toLowerCase();
        
        if (command === 'berita') {
            const arg = q?.toLowerCase()?.trim();
            if (!arg) {
                let txt = `📰 *ᴅᴀꜰᴛᴀʀ sᴜᴍʙᴇʀ ʙᴇʀɪᴛᴀ*\n\n`;
                for (const [key, val] of Object.entries(NEWS_SOURCES)) {
                    const v = val as any;
                    txt += `> ${v.emoji} \`${prefix}${key}\` - ${v.name}\n`;
                }
                txt += `\n_Atau gunakan: \`${prefix}berita <sumber>\`_`;
                return reply(txt);
            }
            
            if (!NEWS_SOURCES[arg]) {
                return reply(`❌ Sumber berita tidak ditemukan.\n> Gunakan: \`${prefix}berita\` untuk melihat daftar.`);
            }
            source = arg;
        }
        
        const newsSource = NEWS_SOURCES[source!];
        if (!newsSource) return reply(`❌ Sumber berita tidak valid.`);
        
        await react('🕕');
        
        try {
            const response = await axios.get(newsSource.url, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 15000
            });
            
            const $ = cheerio.load(response.data, { xmlMode: true });
            const articles: any[] = [];
            
            $('item').each((i, el) => {
                if (i >= 10) return false;
                const title = $(el).find('title').text().trim();
                const link = $(el).find('link').text().trim();
                const pubDate = $(el).find('pubDate').text().trim();
                const description = $(el).find('description').text().trim().replace(/<[^>]*>/g, '').substring(0, 150);
                if (title && link) articles.push({ title, link, pubDate, description });
            });
            
            if (articles.length === 0) return reply(`❌ Tidak ada berita ditemukan.`);
            
            let txt = `${newsSource.emoji} *${newsSource.name.toUpperCase()}*\n`;
            txt += `━━━━━━━━━━━━━━━\n\n`;
            
            for (let i = 0; i < Math.min(articles.length, 7); i++) {
                const article = articles[i];
                txt += `*${i + 1}. ${article.title}*\n`;
                if (article.description) txt += `${article.description}...\n`;
                txt += `🔗 ${article.link}\n`;
                if (article.pubDate) {
                    const d = new Date(article.pubDate);
                    txt += `📅 _${d.toLocaleString('id-ID')}_\n`;
                }
                txt += `\n`;
            }
            
            txt += `━━━━━━━━━━━━━━━\n`;
            txt += `_Total: ${articles.length} artikel tersedia_`;
            
            await reply(txt);
            await react('📰');
        } catch (err) {
            console.error(err);
            await react('❌');
            return reply(`❌ Gagal mengambil berita. Silakan coba lagi nanti.`);
        }
        return;
    }


    if (["hd", "hd2"].includes(command || "")) {
      const typeMedia = Object.keys(m.message || {})[0];
      const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = !!m.message?.imageMessage;

      if (!isImage && !isQuotedImage) {
          return reply(`✨ *ʜᴅ ᴇɴʜᴀɴᴄᴇ*\n\n> Kirim/reply gambar untuk di-enhance\n\n\`${prefix}hd\``);
      }

      await react("🕕");

      try {
          const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
          const stream = await downloadContentFromMessage(target, "image");
          let buffer = Buffer.alloc(0);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }

          if (!buffer || buffer.length === 0) {
              await react("❌");
              return reply(`❌ Gagal mendownload gambar`);
          }


          const tempDir = path.join(__dirname, "temp");
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          const tempFile = path.join(tempDir, `hd_${Date.now()}.jpg`);
          fs.writeFileSync(tempFile, buffer);
          
          const uploadRes = await upload(tempFile);
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
          
          if (!uploadRes || !uploadRes.code) {
              await react("❌");
              return reply("❌ Gagal mengunggah gambar ke server AI.");
          }

          const code = uploadRes.code;
          await new Promise(resolve => setTimeout(resolve, 10000));
          
          let result = await getStatus(code);
          let attempts = 0;
          while (result.status === 'waiting' && attempts < 15) {
              await new Promise(resolve => setTimeout(resolve, 6000));
              result = await getStatus(code);
              attempts++;
          }

          if (!result || !result.downloadUrls || result.downloadUrls.length === 0) {
              await react("❌");
              return reply(`❌ Gagal enhance gambar. Server sedang sibuk atau timeout.`);
          }
          
          await react("✅");

          // Download the result first to send as image or document? 
          // The user example sends it as a document.
          const hdBuffer = await axios.get(result.downloadUrls[0], { responseType: 'arraybuffer' }).then(res => Buffer.from(res.data));

          await sock.sendMessage(m.key.remoteJid!, {
              image: hdBuffer,
              caption: `✅ *HD DONE*`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: m });

      } catch (error: any) {
          if (error.message && error.message.includes("Connection Closed")) return;
          console.error("[HDError]", error);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${error.message}`);
      }
      return;
    }

    if (["ping"].includes(command || "")) {
        if (!sock.user?.id) return reply("❌ Bot sedang offline / Koneksi terputus.");
        await react("🕚");
        const execStart = performance.now();
        try {
          sock.sendPresenceUpdate("composing", m.key.remoteJid!).catch(() => {});
          const t0 = m.messageTimestamp ? Number(m.messageTimestamp) * 1000 : Date.now();
          const waRoundtrip = Math.max(1, Date.now() - t0);
          const cpus = os.cpus();
          const totalMem = os.totalmem(), freeMem = os.freemem();
          
          const cpuStart = performance.now();
          let cpuPct = "0";
          try {
            const c1 = os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); a.total += t; a.idle += c.times.idle; return a; }, { total: 0, idle: 0 });
            await new Promise((r) => setTimeout(r, 400));
            const c2 = os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); a.total += t; a.idle += c.times.idle; return a; }, { total: 0, idle: 0 });
            const td = c2.total - c1.total, id = c2.idle - c1.idle;
            cpuPct = td > 0 ? (((td - id) / td) * 100).toFixed(1) : "1.0";
          } catch { cpuPct = "1.0"; }

          const disk = fs.statfsSync("/");
          const mem = process.memoryUsage();
          const s = {
            ping: waRoundtrip,
            hostname: os.hostname(),
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            v8Version: process.versions.v8,
            uptimeBot: fmtUp(process.uptime()),
            uptimeServer: fmtUp(os.uptime()),
            cpuModel: cpus[0]?.model?.trim() || "Unknown",
            cpuCores: cpus.length,
            cpuSpeed: cpus[0]?.speed || 0,
            cpuLoad: cpuPct,
            loadAvg: os.loadavg().map(l => l.toFixed(2)).join(", "),
            ramTotal: totalMem,
            ramUsed: totalMem - freeMem,
            diskTotal: disk.blocks * disk.bsize,
            diskUsed: (disk.blocks - disk.bfree) * disk.bsize,
            networkRx: 0, 
            networkTx: 0,
            networkInterface: 'eth0',
            heapUsed: fmtSize(mem.heapUsed),
            rss: fmtSize(mem.rss),
            pid: process.pid,
            activeHandles: typeof (process as any).getActiveHandles === 'function' ? (process as any).getActiveHandles().length : 0,
            activeRequests: process.getActiveResourcesInfo ? process.getActiveResourcesInfo().length : "N/A",
            activeBuffers: fmtSize(mem.arrayBuffers || 0),
            dbUsers: instances.size,
            dbGroups: Array.from(instances.values()).reduce((a, b) => a + (b.activeSocket ? 1 : 0), 0),
          };

          const canvasStart = performance.now();
          const testPf = { waRoundtrip, cpuSample: Math.round(performance.now() - cpuStart), canvasTime: "...", totalExec: "...", gcPause: 0 };
          
          const img = await renderPingImage(s, testPf);
          testPf.canvasTime = String(Math.round(performance.now() - canvasStart));
          testPf.totalExec = String(Math.round(performance.now() - execStart));
          const finalImg = await renderPingImage(s, testPf);
          await send({ image: finalImg, caption: `*Pong!* ${waRoundtrip}ms` });
          await react("✅");
        } catch (e: any) {
          reply(`❌ Gagal mengambil status server: ${e.message}`);
        }
        return;
      }

      if (["playtiktok", "ttplay", "tiktokplay"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(
            `🎵 *PLAY TIKTOK*\n\n> Contoh:\n\`${prefix}playtiktok cewe tiktok\``,
          );
        }

        await react("🔍");

        try {
          const videos = await tiktokSearchVideo(text);
          if (!videos || videos.length === 0) {
            await react("❌");
            return reply(`❌ Tidak ditemukan video untuk: ${text}`);
          }

          const video = videos[0];
          const quoted = getVerifiedQuoted(deviceConfig);
          
          let caption = "🎵 *PLAY TIKTOK*\n\n";
          caption += `📌 *Judul:* ${video.title || "-"}\n`;
          caption += `👤 *Author:* ${video.author?.nickname || "-"}\n`;
          caption += `👀 *Views:* ${formatNumber(video.stats?.plays)}\n`;
          caption += `❤️ *Likes:* ${formatNumber(video.stats?.likes)}\n`;
          caption += `💬 *Comments:* ${formatNumber(video.stats?.comments)}\n`;
          caption += `🔁 *Shares:* ${formatNumber(video.stats?.shares)}\n`;
          caption += `🎧 *Music:* ${video.music || "-"}\n`;
          caption += `🔗 *Link:* ${video.link}`;

          await sock.sendMessage(m.key.remoteJid!, {
            video: { url: video.link },
            caption: caption,
            mimetype: "video/mp4",
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (error: any) {
          console.error("[PLAYTIKTOK]", error);
          await react("❌");
          reply(`❌ Terjadi kesalahan: ${error.message || error}`);
        }
        return;
      }

      if (["upch", "uploadch", "uploadsaluran", "uch"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa menggunakan fitur ini!');
        
        const argsUpch = q.split(" ") || [];
        let chId = argsUpch[0]?.includes("@newsletter") ? argsUpch.shift() : (deviceConfig.saluran?.id || "120363426467190619@newsletter");
        const chName = deviceConfig.bot?.name || "CMNTY-BOT";
        const caption = argsUpch.join(" ").trim();

        const quoted = m.message?.extendedTextMessage?.contextInfo?.quotedMessage || m.message;
        const typeMedia = quoted ? Object.keys(quoted)[0] : null;
        const isImage = typeMedia === 'imageMessage';
        const isVideo = typeMedia === 'videoMessage';
        const isAudio = typeMedia === 'audioMessage';
        const isMedia = isImage || isVideo || isAudio;

        if (!isMedia && !caption) {
            return reply(
                `📤 *UPLOAD SALURAN*\n\n` +
                `Kirim/reply media dengan caption:\n` +
                `  \`${prefix}upch 12xxx@newsletter <teks opsional>\`\n\n` +
                `*Support:*\n` +
                `  🖼️ Gambar\n` +
                `  🎥 Video\n` +
                `  🎵 Audio/VN\n` +
                `  📝 Teks (tanpa media)`
            );
        }

        await react("🕕");

        try {
            const ctxInfo = {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: chId,
                    newsletterName: chName,
                    serverMessageId: 1
                }
            };

            const quotedMsg = getVerifiedQuoted(deviceConfig);

            if (!isMedia && caption) {
                await sock.sendMessage(chId!, { text: caption, contextInfo: ctxInfo }, { quoted: quotedMsg as any });
                await react("✅");
                return reply(`✅ Teks berhasil dikirim ke saluran`);
            }

            const mediaBuf = await downloadMediaMessage(m, "buffer", {});
            if (!mediaBuf || mediaBuf.length < 100) throw new Error("Media tidak ditemukan atau gagal didownload");

            if (isImage) {
                await sock.sendMessage(chId!, {
                    image: mediaBuf,
                    caption: caption || undefined,
                    contextInfo: ctxInfo
                }, { quoted: quotedMsg as any });
                await react("✅");
                return reply("✅ Gambar berhasil dikirim ke saluran");
            }

            if (isVideo) {
                await sock.sendMessage(chId!, {
                    video: mediaBuf,
                    caption: caption || undefined,
                    contextInfo: ctxInfo
                }, { quoted: quotedMsg as any });
                await react("✅");
                return reply("✅ Video berhasil dikirim ke saluran");
            }

            if (isAudio) {
                const opusBuf = await toOggOpus(mediaBuf);
                await sock.sendMessage(chId!, {
                    audio: opusBuf,
                    mimetype: "audio/ogg; codecs=opus",
                    ptt: true,
                    contextInfo: ctxInfo
                }, { quoted: quotedMsg as any });
                await react("✅");
                return reply("✅ Audio berhasil dikirim ke saluran");
            }

            reply("❌ Tipe media tidak didukung");
        } catch (e: any) {
            console.error("[UpCh]", e);
            await react("☢");
            reply(`❌ Gagal upload ke saluran: ${e.message || e}`);
        }
        return;
      }

      if (["resetlinkgc", "resetlink", "revokelink", "newlink"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin) return reply("❌ Fitur ini hanya untuk Admin grup!");
        if (!isBotAdmin) return reply("❌ Bot harus menjadi Admin untuk meriset link!");

        await react("🔄");

        try {
          await sock.groupRevokeInvite(m.key.remoteJid!);
          
          await react("✅");
          const msg = `✅ *ʟɪɴᴋ ɢʀᴜᴘ ᴅɪʀᴇsᴇᴛ*\n\nLink grup lama sudah tidak berlaku.\nGunakan \`${prefix}linkgc\` untuk mendapatkan link baru.`;
          
          await sock.sendMessage(m.key.remoteJid!, {
            text: msg,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (error: any) {
          console.error("[RESETLINKGC]", error);
          await react("❌");
          reply(`❌ Gagal meriset link grup: ${error.message || error}`);
        }
        return;
      }



      if (["web2zip", "webtozip", "w2z"].includes(command || "")) {
        const urlToConvert = q?.trim();
        if (!urlToConvert || !urlToConvert.startsWith("http")) {
          return reply(
            `🌐 *WEB TO ZIP*\n\n` +
            `Silakan berikan URL website yang valid.\n\n` +
            `> Contoh:\n` +
            `\`${prefix}web2zip https://github.com\``
          );
        }

        await react("🔍");

        try {
          const { data } = await axios.get(`https://api.nexray.eu.cc/tools/webtozip?url=${encodeURIComponent(urlToConvert)}`, {
            timeout: 60000
          });

          if (!data.status || !data.result?.downloadUrl) {
            await react("❌");
            return reply(`❌ Gagal mengkonversi website. ${data.result?.error?.text || ""}`);
          }

          const result = data.result;
          let cap = `🌐 *WEB TO ZIP SUCCESS*\n\n`;
          cap += `📌 *URL:* ${result.url}\n`;
          cap += `📄 *File Terdeteksi:* ${result.copiedFilesAmount}\n`;
          cap += `⏳ *Response Time:* ${data.response_time}\n\n`;
          cap += `_Sedang mengirim file ZIP, mohon tunggu..._`;

          await sock.sendMessage(m.key.remoteJid!, {
            text: cap,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: "120363426467190619@newsletter",
                    newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                    serverMessageId: 1
                }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

          await sock.sendMessage(m.key.remoteJid!, {
              document: { url: result.downloadUrl },
              mimetype: "application/zip",
              fileName: `website_copy_${Date.now()}.zip`,
              contextInfo: {
                  ...getContextInfo(deviceConfig, m),
                  forwardingScore: 99,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                      newsletterJid: "120363426467190619@newsletter",
                      newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                      serverMessageId: 1
                  }
              }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

          await react("✅");
        } catch (error: any) {
          console.error("[WEB2ZIP]", error);
          await react("❌");
          reply(`❌ Terjadi kesalahan: ${error.message || error}`);
        }
        return;
      }

      if (["ytmp3", "ytaudio", "youtubemp3"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(`🎵 *YᴏᴜTᴜʙᴇ MP3 Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link video YouTube untuk mendownload audionya\n\n\`Contoh: ${prefix}${command} https://youtube.com/watch?v=xxxx\``);
        }
        if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
          return reply("❌ URL tidak valid! Harus berisi tautan dari YouTube");
        }
        await react("🕕");
        try {
          const result = await getAudioDownload(text);
          const quoted = getVerifiedQuoted(deviceConfig);
          
          if (result.isFallback) {
            const mp3Buffer = await fallbackToMp3Buffer(result.download);
            await sock.sendMessage(m.key.remoteJid!, {
              audio: mp3Buffer,
              mimetype: "audio/mpeg",
              ptt: false,
              fileName: `${result.title || "audio"}.mp3`,
              contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
              }
            }, { quoted: quoted as any });
          } else {
            await sock.sendMessage(m.key.remoteJid!, {
              audio: { url: result.download },
              mimetype: "audio/mpeg",
              ptt: false,
              fileName: result.title || "audio.mp3",
              contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
              }
            }, { quoted: quoted as any });
          }
          await react("✅");
        } catch (err: any) {
          console.error("[YTMP3]", err);
          await react("❌");
          reply(`❌ Gagal mengunduh audio: ${err.message || err}`);
        }
        return;
      }

      if (["ytmp4", "ytvideo", "youtubemp4"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(`📺 *YᴏᴜTᴜʙᴇ MP4 Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link video YouTube untuk mendownload videonya\n\n\`Contoh: ${prefix}${command} https://youtube.com/watch?v=xxxx\``);
        }
        if (!text.includes("youtube.com") && !text.includes("youtu.be")) {
          return reply("❌ URL tidak valid! Harus berisi tautan dari YouTube");
        }
        await react("🕕");
        try {
          const downloadUrl = await getVideoDownloadUrl(text);
          const quoted = getVerifiedQuoted(deviceConfig);
          
          await sock.sendMessage(m.key.remoteJid!, {
            video: { url: downloadUrl },
            caption: `📺 *YᴏᴜTᴜʙᴇ MP4 Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n✅ Berhasil mengunduh video anda.`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });
          await react("✅");
        } catch (err: any) {
          console.error("[YTMP4]", err);
          await react("❌");
          reply(`❌ Gagal mengunduh video: ${err.message || err}`);
        }
        return;
      }

      if (["spotifydl", "spdl", "spotify-dl", "spotdl"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(`🎵 *Sᴘᴏᴛɪꜰʏ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link lagu Spotify untuk mendownload audionya\n\n\`Contoh: ${prefix}${command} https://open.spotify.com/track/xxxx\``);
        }
        if (!/open\.spotify\.com\/track/i.test(text)) {
          return reply("❌ URL tidak valid! Harus berisi tautan lagu dari Spotify");
        }
        await react("🕕");
        try {
          const { data } = await axios.get(
            `https://api.azbry.com/api/download/spotify?url=${encodeURIComponent(text)}`,
            {
              timeout: 30000,
              headers: { "user-agent": "Mozilla/5.0" },
            }
          );

          if (!data?.status || !data?.downloadLink) {
            throw new Error(data?.message || "Gagal mengambil lagu Spotify");
          }

          const artist = Array.isArray(data.author) ? data.author.join(", ") : (data.author || "Spotify");
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            audio: { url: data.downloadLink },
            mimetype: "audio/mpeg",
            fileName: `${artist} - ${data.title}.mp3`,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              },
              externalAdReply: {
                title: data.title,
                body: artist,
                thumbnailUrl: data.cover,
                mediaType: 1,
                sourceUrl: text,
                renderLargerThumbnail: true
              }
            }
          }, { quoted: quoted as any });
          await react("✅");
        } catch (err: any) {
          console.error("[SPOTIFYDL]", err);
          await react("❌");
          reply(`❌ Gagal mengunduh lagu: ${err.message || err}`);
        }
        return;
      }

      if (["videy", "videydl"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(`🎬 *Vɪᴅᴇʏ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link video Videy untuk mendownload videonya\n\n\`Contoh: ${prefix}${command} https://videy.co/v?id=xxxx\``);
        }
        if (!text.includes("videy.co")) {
          return reply("❌ URL tidak valid! Harus berisi tautan dari Videy.co");
        }
        await react("🕕");
        try {
          const { data } = await axios.get(`https://api.nexray.eu.cc/downloader/videy?url=${encodeURIComponent(text)}`, { timeout: 15000 });
          if (!data?.status || !data?.result) {
            throw new Error("Gagal mengambil video Videy.");
          }
          
          const quoted = getVerifiedQuoted(deviceConfig);
          await sock.sendMessage(m.key.remoteJid!, {
            video: { url: data.result },
            caption: `🎬 *Vɪᴅᴇʏ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n✅ Berhasil mengunduh video anda.`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });
          await react("✅");
        } catch (err: any) {
          console.error("[VIDEY]", err);
          await react("❌");
          reply(`❌ Gagal mengunduh video: ${err.message || err}`);
        }
        return;
      }

      if (["terabox", "tb", "tera"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(`📦 *TᴇʀᴀBᴏx Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link TeraBox untuk mendownload filenya\n\n\`Contoh: ${prefix}${command} https://terabox.com/s/xxxx\``);
        }
        if (!text.includes("terabox") && !text.includes("1024terabox")) {
          return reply("❌ URL tidak valid! Harus berisi tautan dari TeraBox");
        }
        await react("🕕");
        try {
          const { data } = await axios.get(`https://api.nexray.eu.cc/downloader/terabox?url=${encodeURIComponent(text)}`, { timeout: 30000 });
          if (!data || !data[0]) {
            throw new Error("Gagal mengambil data TeraBox. File mungkin terlalu besar atau link tidak dapat diakses.");
          }
          
          const result = data[0];
          const fileName = result.server_filename || "file";
          const dlink = result.dlink;

          const quoted = getVerifiedQuoted(deviceConfig);
          const type = fileName.match(/\.(mp4|mkv|mov)$/i) ? "video" : fileName.match(/\.(jpg|jpeg|png|gif)$/i) ? "image" : "document";

          await sock.sendMessage(m.key.remoteJid!, {
            [type]: { url: dlink },
            fileName: fileName,
            caption: `📦 *TᴇʀᴀBᴏx Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n📝 *Nama:* ${fileName}`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          } as any, { quoted: quoted as any });
          await react("✅");
        } catch (err: any) {
          console.error("[TERABOX]", err);
          await react("❌");
          reply(`❌ Gagal mengunduh file: ${err.message || err}`);
        }
        return;
      }

      if (["fakeff"].includes(command || "")) {
        const text = q;
        if (!text) return reply(`*FAKE FF*\n\n> Contoh: ${prefix}fakeff My Name`);
        await react("🕕");
        try {
          const response = await axios.get(`https://api.ourin.my.id/api/fake-free-fire-2?text=${encodeURIComponent(text)}&bg=random`, {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: `*FAKE FREE FIRE*\n\n> *Text:* ${text}`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[FAKEFF]", err);
          await react("❌");
          reply(`❌ Gagal membuat gambar FF: ${err.message || err}`);
        }
        return;
      }

      if (["fakebankjago"].includes(command || "")) {
        const [nama, nominal] = q.split(",");
        if (!nama || !nominal) {
            return reply(`*FAKE BANK JAGO*\n\n> Masukkan nama dan nominal\n\n\`Contoh: ${prefix}fakebankjago Zann,10000\``);
        }
        if (isNaN(nominal as any)) return reply(`*HARAP MASUKKAN ANGKA UNTUK NOMINAL*`);
        
        await react("🕕");
        try {
          const saldo = Number(nominal.replace(/[^0-9]/g, '')).toLocaleString('id-ID');
          const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: '2-digit', hour12: false });
          const h = Number(hour);
          let waktu = 'Malam';
          if (h >= 4 && h < 11) waktu = 'Pagi';
          else if (h >= 11 && h < 15) waktu = 'Siang';
          else if (h >= 15 && h < 18) waktu = 'Sore';
          
          const greet = `Selamat ${waktu}, ${nama}`;
          
          // Menggunakan API eksternal untuk konsistensi atau canvas lokal jika API tidak tersedia
          // Karena user memberikan kode skia-canvas, saya akan mencoba mengimplementasikannya via API kita sendiri jika ada
          // Tapi di sini saya akan gunakan API direct agar lebih cepat dan ringan di server
          const canvasUrl = `https://api.ourin.my.id/api/fake-bank-jago?name=${encodeURIComponent(nama)}&nominal=${encodeURIComponent(nominal)}&greet=${encodeURIComponent(greet)}`;
          
          const response = await axios.get(canvasUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: `*FAKE BANK JAGO*\n\n> *Nama:* ${nama}\n> *Nominal:* Rp ${saldo}`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[FAKEBANKJAGO]", err);
          await react("❌");
          reply(`❌ Gagal membuat gambar Bank Jago: ${err.message || err}`);
        }
        return;
      }

      if (["fakestory", "fstory", "igstory"].includes(command || "")) {
        const username = q.trim() || m.pushName || "User";
        let avatarBuffer: Buffer | null = null;
        let imageBuffer: Buffer | null = null;

        const qm = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const qContentType = qm ? getContentType(qm) : null;
        const actualType = getContentType(m.message || {});

        // Cek gambar untuk story
        if (qContentType === "imageMessage") {
            try {
                imageBuffer = await downloadMediaMessage(
                    { key: m.message?.extendedTextMessage?.contextInfo?.stanzaId, message: qm } as any,
                    "buffer",
                    {},
                    { logger: pino({ level: "silent" }), reuploadRequest: (sock as any).updateMediaMessage }
                ) as Buffer;
            } catch (e) {
                console.error("Download quoted story image error:", e);
            }
        } else if (actualType === "imageMessage") {
            try {
                imageBuffer = await downloadMediaMessage(
                    m,
                    "buffer",
                    {},
                    { logger: pino({ level: "silent" }), reuploadRequest: (sock as any).updateMediaMessage }
                ) as Buffer;
            } catch (e) {
                console.error("Download story image error:", e);
            }
        }

        if (!imageBuffer) {
            return reply(`📷 *ꜰᴀᴋᴇ sᴛᴏʀʏ*\n\n> Reply gambar!\n\n> Format: \`${prefix}fakestory <nama>\`\n> Contoh: \`${prefix}fakestory ojisaputra\``);
        }

        await react("🕕");
        try {
            // Cek avatar
            try {
                const ppUrl = await sock.profilePictureUrl(sender, "image");
                const ppRes = await axios.get(ppUrl, { responseType: "arraybuffer" });
                avatarBuffer = Buffer.from(ppRes.data);
            } catch (error) {
                // Fallback pp-kosong
                try {
                    const fallbackRes = await axios.get("https://c.termai.cc/i160/3bfn6u.jpg", { responseType: "arraybuffer" });
                    avatarBuffer = Buffer.from(fallbackRes.data);
                } catch (e) {
                    avatarBuffer = null;
                }
            }

            if (!avatarBuffer) throw new Error("Gagal mengambil avatar");

            const resultBuffer = await createFakeStory(username, avatarBuffer, imageBuffer);
            const quoted = getVerifiedQuoted(deviceConfig);

            await sock.sendMessage(m.key.remoteJid!, {
                image: resultBuffer,
                caption: `📸 *ꜰᴀᴋᴇ sᴛᴏʀʏ* oleh @${sender.split("@")[0]}`,
                mentions: [sender],
                contextInfo: {
                    ...getContextInfo(deviceConfig, m),
                    forwardingScore: 99,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363426467190619@newsletter",
                        newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                        serverMessageId: 1
                    }
                }
            }, { quoted: quoted as any });

            await react("✅");
        } catch (err: any) {
            console.error("[FAKESTORY]", err);
            await react("❌");
            reply(`❌ Coba lagi: ${err.message || err}`);
        }
        return;
      }

      if (command === "qris") {
        await react("💳");
        await sock.sendMessage(m.key.remoteJid!, {
          image: { url: "https://c.termai.cc/i109/uXeoh.png" },
          caption: `💸 *ᴅᴏɴᴀsɪ / Qʀɪs*\n\n> Terima kasih telah ingin mendukung pengembangan bot ini! Silahkan scan QRIS di atas untuk berdonasi.\n\n*Developer:* ojisaputra\n*Metode:* Dana / QRIS All Pay`,
          contextInfo: {
            ...getContextInfo(deviceConfig, m),
            forwardingScore: 99,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363426467190619@newsletter",
              newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
              serverMessageId: 1
            }
          }
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
      }

      if (["math", "latex", "rumus"].includes(command || "")) {
        if (!q) {
          return reply(
            `📐 *ʀᴇɴᴅᴇʀ ᴍᴀᴛᴇᴍᴀᴛɪᴋᴀ*\n\n` +
              `*Contoh:* \`${prefix}math E = mc^2\`\n` +
              `*LaTeX:* \`${prefix}math \\frac{x^2}{y^2}\`\n\n` +
              `> Render rumus LaTeX menjadi gambar otomatis.`
          );
        }

        await react("🕕");
        try {
          const imageBuffer = await renderLatexToPng(q);
          
          await sock.sendMessage(m.key.remoteJid!, {
            image: imageBuffer,
            caption: `📐 *ʀᴇɴᴅᴇʀ ᴍᴀᴛᴇᴍᴀᴛɪᴋᴀ*\n\n> Request by: @${sender.split("@")[0]}`,
            mentions: [sender],
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

          await react("✅");
        } catch (err: any) {
          console.error("[MATH]", err);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["pakustad", "pak-ustad", "tanyaustad"].includes(command || "")) {
        if (!q) {
          return reply(`⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}pakustad <pertanyaan>\`\n\n> Contoh: \`${prefix}pakustad kenapa aku ganteng\``);
        }
        
        await react("🕕");
        try {
          const apiUrl = `https://api.cuki.biz.id/api/canvas/ustadz?apikey=cuki-x&text=${encodeURIComponent(q)}`;
          
          await sock.sendMessage(m.key.remoteJid!, {
            image: { url: apiUrl },
            caption: `👳‍♂️ *ᴘᴀᴋ ᴜsᴛᴀᴅ*\n\n📝 *Pertanyaan:* ${q}\n\n> Request by: @${sender.split("@")[0]}`,
            mentions: [sender],
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          
          await react("✅");
        } catch (err: any) {
          console.error("[PAKUSTAD]", err);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["wafat", "rip"].includes(command || "")) {
        let textParts = q.split("|").map(s => s.trim());
        let nama = textParts[0] || m.pushName || "Someone";
        
        const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
        const now = new Date();
        const defaultTanggal = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
        
        let tanggal = textParts[1] || defaultTanggal;
        let pesan = textParts[2] || "Innalillahi wa inna ilaihi roji'un";

        const qm = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const qContentType = qm ? getContentType(qm) : null;
        const actualType = getContentType(m.message || {});
        
        let mediaBuffer: Buffer | null = null;
        if (actualType === "imageMessage") {
            mediaBuffer = await downloadMediaMessage(m, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });
        } else if (qContentType === "imageMessage") {
            mediaBuffer = await downloadMediaMessage(
                { key: m.message?.extendedTextMessage?.contextInfo?.stanzaId, message: qm } as any,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
            );
        }

        if (!mediaBuffer) {
            return reply(`🖤 *ᴘᴇᴍʙᴜᴀᴛ ᴋᴀʀᴛᴜ ᴡᴀғᴀᴛ*\n\n> Kirim/reply gambar dengan command ini untuk membuat kartu ucapan duka cita.\n\n*Format:* \`${prefix}wafat nama | tanggal | ucapan\`\n*Contoh:* \`${prefix}wafat John Doe | 6 Juli 2026 | Semoga amal ibadahnya diterima\``);
        }

        await react("🕕");
        try {
            const form = new FormData();
            form.append('nama', nama);
            form.append('tanggal', tanggal);
            form.append('pesan', pesan);
            form.append('foto', mediaBuffer, {
                filename: 'foto.jpg',
                contentType: 'image/jpeg'
            });

            const response = await axios.post('https://satriacanvas.vercel.app/api/wafat', form, {
                headers: { ...form.getHeaders() },
                responseType: 'arraybuffer'
            });

            const resultBuffer = Buffer.from(response.data);

            await sock.sendMessage(chatId, {
                image: resultBuffer,
                caption: `🖤 *ᴋᴀʀᴛᴜ ᴡᴀғᴀᴛ sᴜᴋsᴇs ᴅɪʙᴜᴀᴛ*\n\n> *Nama:* ${nama}\n> *Tanggal:* ${tanggal}\n> *Pesan:* ${pesan}`,
                contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: m });

            await react("✅");
        } catch (err: any) {
            console.error("[WAFAT]", err);
            await react("❌");
            reply(`❌ Gagal membuat gambar wafat: ${err.message || err}`);
        }
        return;
      }

      if (["gura", "gawr"].includes(command || "")) {
        const qm = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const qContentType = qm ? getContentType(qm) : null;
        const actualType = getContentType(m.message || {});
        
        let mediaBuffer: Buffer | null = null;
        if (actualType === "imageMessage") {
            mediaBuffer = await downloadMediaMessage(m, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage });
        } else if (qContentType === "imageMessage") {
            mediaBuffer = await downloadMediaMessage(
                { key: m.message?.extendedTextMessage?.contextInfo?.stanzaId, message: qm } as any,
                "buffer",
                {},
                { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
            );
        }

        if (!mediaBuffer) {
            return reply(`🦈 *ɢᴜʀᴀ ᴇғғᴇᴄᴛ*\n\n> Kirim/reply gambar dengan command ini\n\n*Contoh:* \`${prefix}gura\``);
        }

        await react("🕕");
        try {
            const form = new FormData();
            form.append('file', mediaBuffer, {
                filename: 'image.jpg',
                contentType: 'image/jpeg'
            });

            const uploadRes = await axios.post('https://c.termai.cc/api/upload?key=AIzaBj7z2z3xBjsk', form, {
                headers: { ...form.getHeaders() }
            });

            const imageUrl = uploadRes.data.data.url;
            const effectUrl = `https://api.nexray.web.id/canvas/gura?url=${encodeURIComponent(imageUrl)}`;
            
            await sock.sendMessage(m.key.remoteJid!, {
                image: { url: effectUrl },
                caption: `🦈 *ɢᴜʀᴀ ᴇғғᴇᴄᴛ* sukses diterapkan!\n\n> Request by: @${sender.split("@")[0]}`,
                mentions: [sender],
                contextInfo: {
                    ...getContextInfo(deviceConfig, m),
                    forwardingScore: 99,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: "120363426467190619@newsletter",
                        newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                        serverMessageId: 1
                    }
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });

            await react("✅");
        } catch (err: any) {
            console.error("[GURA]", err);
            await react("☢");
            reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["quran", "surah", "alquran", "bacaquran"].includes(command || "")) {
        const query = q.trim();
        if (!query) {
          return reply(
            `📖 *ǫᴜʀᴀɴ*\n\n` +
              `> Masukkan nama surah\n\n` +
              `*Contoh:* \`${prefix}quran al fatihah\`\n` +
              `*Contoh:* \`${prefix}quran al baqarah\``
          );
        }

        await react("🔍");
        try {
          const slug = query.toLowerCase().replace(/\s+/g, "-");
          const url = `https://quran.nu.or.id/${slug}`;
          const res = await axios.get(url);
          const html = res.data;
          const $ = cheerio.load(html);

          const title = $("h1").first().text().trim();
          const info = $("h1").next("span").text().trim();

          const results: any[] = [];
          $("div[id]").each((i, el) => {
            const id = $(el).attr("id");
            if (!/^\d+$/.test(id || "")) return;

            const arab = $(el).find('[dir="rtl"]').first().text().trim();
            const latin = $(el).find(".text-primary-500").first().text().trim();
            const arti = $(el).find(".text-neutral-700").first().text().trim();

            if (arab && latin && arti) {
              results.push({ ayat: Number(id), arab, latin, arti });
            }
          });

          if (!results.length) {
            await react("❌");
            return reply(`❌ Surah *${query}* tidak ditemukan`);
          }

          let teks = `📖 *${title}*\n${info}\n\n`;
          for (const i of results) {
            teks += `${i.arab}\n${i.latin}\n_${i.arti}_\n\n`;
          }

          await react("✅");

          const trimmed = teks.trim();
          const contextInfo = {
            ...getContextInfo(deviceConfig, m),
            forwardingScore: 99,
            isForwarded: true,
            forwardedNewsletterMessageInfo: {
              newsletterJid: "120363426467190619@newsletter",
              newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
              serverMessageId: 1
            }
          };

          if (trimmed.length > 6000) { // Limit for a single message to avoid lag
            const chunks = [];
            let current = "";
            for (const item of results) {
              const block = `${item.arab}\n${item.latin}\n_${item.arti}_\n\n`;
              if ((current + block).length > 6000) {
                chunks.push(current.trim());
                current = "";
              }
              current += block;
            }
            if (current.trim()) chunks.push(current.trim());

            for (let i = 0; i < chunks.length; i++) {
              const header = i === 0 ? `📖 *${title}*\n${info}\n\n` : `📖 *${title} (Lanjutan ${i + 1})*\n\n`;
              await sock.sendMessage(m.key.remoteJid!, { 
                text: header + chunks[i],
                contextInfo 
              }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            }
          } else {
            await sock.sendMessage(m.key.remoteJid!, { 
              text: trimmed,
              contextInfo 
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          }
        } catch (err: any) {
          console.error("[QURAN]", err);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["playtiktok", "ttplay", "tiktokplay"].includes(command || "")) {
        const query = q.trim();
        if (!query) {
          return reply(
            `🎵 *PLAY TIKTOK*\n\n> Contoh:\n\`${prefix}playtiktok cewe tiktok\``,
          );
        }

        await react("🔍");

        try {
          const videos = await tiktokSearchVideo(query);
          if (!videos || videos.length === 0) {
            await react("❌");
            return reply(`❌ Tidak ditemukan video untuk: ${query}`);
          }

          const video = videos[0];
          const formatNumber = (n: number) => {
              const value = Number(n) || 0;
              if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
              if (value >= 1000) return (value / 1000).toFixed(1) + "K";
              return value.toString();
          }

          let caption = "🎵 *PLAY TIKTOK*\n\n";
          caption += `📌 *Judul:* ${video.title || "-"}\n`;
          caption += `👤 *Author:* ${video.author?.nickname || "-"}\n`;
          caption += `👀 *Views:* ${formatNumber(video.stats?.plays)}\n`;
          caption += `❤️ *Likes:* ${formatNumber(video.stats?.likes)}\n`;
          caption += `💬 *Comments:* ${formatNumber(video.stats?.comments)}\n`;
          caption += `🔁 *Shares:* ${formatNumber(video.stats?.shares)}\n`;
          caption += `🎧 *Music:* ${video.music || "-"}\n`;
          caption += `🔗 *Link:* ${video.link}`;

          await sock.sendMessage(m.key.remoteJid!, {
            video: { url: video.link },
            caption: caption,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

          await react("✅");
        } catch (error: any) {
          console.error("[PLAYTIKTOK]", error);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${error.message}`);
        }
        return;
      }

      if (["mediafiredl", "mfdl", "mediafire", "mf"].includes(command || "")) {
        const url = q.trim();
        if (!url) {
          return reply(
            `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n` +
              `> \`${prefix}mfdl <url>\`\n\n` +
              `*Contoh:* \`${prefix}mfdl https://www.mediafire.com/file/xxx\``
          );
        }

        if (!url.match(/mediafire\.com/i)) {
          return reply(`❌ *URL tidak valid. Gunakan link MediaFire.*`);
        }

        await react("🕕");
        try {
          const result = await mediafire(url);
          await sock.sendMessage(m.key.remoteJid!, {
            document: { url: result.download.link_download },
            fileName: result.meta.title,
            mimetype: result.download.mimetype,
            caption: `✅ *MᴇᴅɪᴀFɪʀᴇ Dᴏᴡɴʟᴏᴀᴅ*\n\n` +
                     `📝 *Nama:* ${result.meta.title}\n` +
                     `📂 *Size:* ${result.download.size}\n\n` +
                     `> Request by: @${sender.split("@")[0]}`,
            mentions: [sender],
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

          await react("✅");
        } catch (err: any) {
          console.error("[MFDL ERROR]", err);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["murrotal", "murottal", "audioquran", "quraudio"].includes(command || "")) {
        const query = q.trim();
        if (!query) {
          return reply(
            `🎧 *ᴍᴜʀʀᴏᴛᴛᴀʟ*\n\n` +
              `> Masukkan nama surah\n\n` +
              `*Contoh:* \`${prefix}murrotal al fatihah\`\n` +
              `*Contoh:* \`${prefix}murrotal ar rahman\``
          );
        }

        await react("🔍");
        try {
          const res = await axios.get("https://islamipedia.id/murottal/");
          const html = res.data;
          const $ = cheerio.load(html);

          const data = $(".surah-item")
            .map((i, el) => ({
              no: parseInt($(el).find("h5").text().split(".")[0]),
              surah: ($(el).attr("data-title") || "").toLowerCase(),
              arti: $(el).find("p").text().trim(),
              audio: $(el).attr("data-audio") || "",
            }))
            .get();

          const searchQuery = query.toLowerCase().replace(/[^a-z0-9]/g, "");
          const find = data.find((v) =>
            v.surah.replace(/[^a-z0-9]/g, "").includes(searchQuery)
          );

          if (!find || !find.audio) {
            await react("❌");
            return reply(`❌ Surah *${query}* tidak ditemukan`);
          }

          await react("✅");
          await sock.sendMessage(m.key.remoteJid!, {
            audio: { url: find.audio },
            mimetype: "audio/mp4",
            ptt: false,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } catch (err: any) {
          console.error("[MUROTTAL]", err);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["fakedev"].includes(command || "")) {
        const name = q.trim();
        if (!name) {
          return reply(
            `🎮 *ꜰᴀᴋᴇ ᴅᴇᴠᴇʟᴏᴘᴇʀ*\n\n` +
              `> Masukkan nama untuk profile\n\n` +
              `*ᴄᴀʀᴀ ᴘᴀᴋᴀɪ:*\n` +
              `> 1. Kirim foto + caption \`${prefix}fakedev <nama>\`\n` +
              `> 2. Reply foto dengan \`${prefix}fakedev <nama>\``,
          );
        }
        
        let mediaBuffer: Buffer | null = null;
        const qm = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const qContentType = qm ? getContentType(qm) : null;
        const actualType = getContentType(m.message || {});
        
        if (qContentType === "imageMessage") {
            try {
                mediaBuffer = await downloadMediaMessage(
                    { key: m.message?.extendedTextMessage?.contextInfo?.stanzaId, message: qm } as any,
                    "buffer",
                    {},
                    { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
                ) as Buffer;
            } catch (e) {
                console.error("Download quoted image error:", e);
            }
        } else if (actualType === "imageMessage") {
            try {
                mediaBuffer = await downloadMediaMessage(
                    m,
                    "buffer",
                    {},
                    { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
                ) as Buffer;
            } catch (e) {
                console.error("Download image error:", e);
            }
        } else {
            try {
                const ppUrl = await sock.profilePictureUrl(sender, "image");
                const ppRes = await axios.get(ppUrl, { responseType: "arraybuffer" });
                mediaBuffer = Buffer.from(ppRes.data);
            } catch (error) {
                // Fallback to anonymous or error
                mediaBuffer = null;
            }
        }

        if (!mediaBuffer) return reply("❌ Kirim/reply gambar atau pastikan foto profil Anda terlihat!");

        await react("🕕");
        try {
          const gmbr = await uploadTo0x0(mediaBuffer);
          if (!gmbr) throw new Error("Gagal mengunggah gambar ke server sementara");
          
          const apiUrl = `https://api.ourin.my.id/api/fake-developer-3?text=${encodeURIComponent(name)}&image=${encodeURIComponent(gmbr)}&verified=true`;
          
          const response = await axios.get(apiUrl, {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: `🎮 *ꜰᴀᴋᴇ ᴅᴇᴠᴇʟᴏᴘᴇʀ*\n\n> *Name:* ${name}\n> *Verified:* True`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[FAKEDEV]", err);
          await react("❌");
          reply(`❌ Coba lagi: ${err.message || err}`);
        }
        return;
      }

      if (["hentai"].includes(command || "")) {
        await react("🔞");
        try {
          const response = await axios.get("https://api.ourin.my.id/api/anime-hentai", {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: "🔞 *Hᴇɴᴛᴀɪ*",
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[HENTAI]", err);
          await react("❌");
          reply(`❌ Gagal mengambil gambar: ${err.message || err}`);
        }
        return;
      }

      if (["gangbang"].includes(command || "")) {
        await react("🔞");
        try {
          const response = await axios.get("https://api.ourin.my.id/api/anime-gangbang", {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: "🔞 *Gᴀɴɢʙᴀɴɢ*",
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[GANGBANG]", err);
          await react("❌");
          reply(`❌ Gagal mengambil gambar: ${err.message || err}`);
        }
        return;
      }

      if (["kasedaiki"].includes(command || "")) {
        await react("🔞");
        try {
          const response = await axios.get("https://api.ourin.my.id/api/kasedaiki", {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: "🔞 *Kᴀsᴇᴅᴀɪᴋɪ*",
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[KASEDAIKI]", err);
          await react("❌");
          reply(`❌ Gagal mengambil gambar: ${err.message || err}`);
        }
        return;
      }

      if (["dongart"].includes(command || "")) {
        await react("🔞");
        try {
          const response = await axios.get("https://api.cmnty.web.id/random/dongart", {
            responseType: "arraybuffer",
            timeout: 30000,
          });

          const buffer = Buffer.from(response.data);
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            image: buffer,
            caption: "🔞 *Dᴏɴɢᴀʀᴛ*",
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });

          await react("✅");
        } catch (err: any) {
          console.error("[DONGART]", err);
          await react("❌");
          reply(`❌ Gagal mengambil gambar: ${err.message || err}`);
        }
        return;
      }

      if (["snackvideodl", "svdl", "snackvideo", "sv"].includes(command || "")) {
        const text = q;
        if (!text) {
          return reply(`🎬 *SɴᴀᴄᴋVɪᴅᴇᴏ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link video SnackVideo untuk mendownload videonya\n\n\`Contoh: ${prefix}${command} https://www.snackvideo.com/@xxx/video/xxx\``);
        }
        if (!text.match(/snackvideo\.com/i)) {
          return reply("❌ URL tidak valid! Harus berisi tautan dari SnackVideo");
        }
        await react("🕕");
        try {
          const data = await snackvideo(text);
          if (!data?.status || !data?.result?.videoUrl) {
            throw new Error("Gagal mengambil video SnackVideo. Video mungkin privat atau tidak ditemukan.");
          }
          
          const quoted = getVerifiedQuoted(deviceConfig);
          await sock.sendMessage(m.key.remoteJid!, {
            video: { url: data.result.videoUrl },
            caption: `🎬 *SɴᴀᴄᴋVɪᴅᴇᴏ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n✅ Berhasil mengunduh video anda.`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });
          await react("✅");
        } catch (err: any) {
          console.error("[SNACKVIDEO]", err);
          await react("❌");
          reply(`❌ Gagal mengunduh video: ${err.message || err}`);
        }
        return;
      }

      if (["threaddl", "tdl", "threads", "threadsdl"].includes(command || "")) {
        const text = q;
        if (!text || !/threads/i.test(text)) {
          return reply(`❌ Gunakan URL Threads yang valid\n\n\`Contoh: ${prefix}${command} https://www.threads.net/@xxx/post/xxx\``);
        }

        await react("🕕");

        try {
          const result = await threadsdl(text);
          const images = [];
          for (const group of result.images || []) {
            if (!Array.isArray(group)) continue;
            const best = group.sort((a: any, b: any) => b.width - a.width)[0];
            if (best?.url) images.push(best.url);
          }

          if (images.length === 0) {
            throw new Error("Tidak ada gambar ditemukan");
          }

          const mediaList = images.map(url => ({ image: { url } }));
          const quoted = getVerifiedQuoted(deviceConfig);

          await sock.sendMessage(m.key.remoteJid!, {
            albumMessage: mediaList
          }, { quoted: quoted as any });

          await react("✅");

        } catch (err: any) {
          console.error("[ThreadsDL]", err.message);
          await react("❌");
          reply(`❌ Gagal mengunduh postingan Threads: ${err.message}`);
        }
        return;
      }

      if (["tiktok", "tt", "ttmp4", "tiktokdl", "ttdown"].includes(command || "")) {
        const url = args[0]?.trim();
        if (!url) {
          await react("❌");
          return reply(
            `🎵 *TɪᴋTᴏᴋ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link video TikTok untuk mendownload video tanpa watermark\n\n\`Contoh: ${prefix}${command} https://vt.tiktok.com/xxxx\``,
          );
        }

        await react("🕕");
        try {
          const result = await tiktokDl(url);

          if (result.error || !result.data || result.data.length === 0) {
            await react("❌");
            return reply(
              `❌ *Gagal:* ${result.error || "Video tidak ditemukan / Private."}`,
            );
          }

          if (result.durations > 0 && result.duration !== "0 Seconds") {
            let zann = result.data.find(
              (e: any) => e.type == "nowatermark_hd" || e.type == "nowatermark",
            );

            if (zann && zann.url) {
              await send({
                video: { url: zann.url },
                caption: `🎬 *TɪᴋTᴏᴋ Vɪᴅᴇᴏ*\n\n📝 *Judul:* ${result.title || "-"}\n👤 *Author:* ${result.author?.nickname || "-"}\n⏱️ *Durasi:* ${result.duration}\n🌍 *Region:* ${result.region}\n📅 *Diupload:* ${result.taken_at}\n\n📊 *Statistik:*\n👀 Views: ${result.stats?.views}\n❤️ Likes: ${result.stats?.likes}\n💬 Comment: ${result.stats?.comment}\n\n✅ *Sukses Download!*`,
              });
            } else {
              await react("❌");
              return reply(`❌ Video no-watermark tidak ditemukan.`);
            }
          } else {
            // Slide/Album images
            const images = result.data?.map((zan: any) => ({
                image: { url: zan.url }
            }));
            
            if (images && images.length > 0) {
                await sock.sendMessage(m.key.remoteJid!, {
                    albumMessage: images
                }, { quoted: m });
            } else {
                await react("❌");
                return reply(`❌ Gambar slide tidak ditemukan.`);
            }
          }
          await react("✅");
        } catch (e: any) {
          console.error("TikTok downloader error:", e.message);
          await react("❌");
          await reply(
            `❌ Halo ${m.pushName || "Unknown"}, terjadi kesalahan saat menjalankan command ${prefix}${command}:\n\n> ${e.message}`,
          );
        }
        return;
      }

      if (["kodepos", "carikodepos"].includes(command || "")) {
        await kodeposHandler(m, sock, q, deviceId);
        return;
      }

      if (["akankah", "akan", "will"].includes(command || "")) {
        await akankahHandler(m, sock, q, deviceId);
        return;
      }

      if (["confess", "confession", "menfess", "anonim"].includes(command || "")) {
        await confessHandler(m, sock, q, deviceId);
        return;
      }

      if (["dimana", "where", "mana"].includes(command || "")) {
        await dimanaHandler(m, sock, q, deviceId);
        return;
      }

      if (["gay", "howgay"].includes(command || "")) {
        await gayHandler(m, sock, q, deviceId);
        return;
      }

      if (["haruskah", "harus", "should"].includes(command || "")) {
        await haruskahHandler(m, sock, q, deviceId);
        return;
      }

      if (["jodoh", "jodohin"].includes(command || "")) {
        await jodohHandler(m, sock, q, deviceId);
        return;
      }

      if (["coba", "try"].includes(command || "")) {
        await cobaHandler(m, sock, q, deviceId);
        return;
      }

      if (["cekpacar", "pacar", "pasangan", "gebetan"].includes(command || "")) {
        await cekpacarHandler(m, sock, q, deviceId);
        return;
      }

      if (["cekkhodam", "khodam", "cekhodam"].includes(command || "")) {
        await cekkhodamHandler(m, sock, q, deviceId);
        return;
      }

      if (["bisakah", "bisa"].includes(command || "")) {
        await bisakahHandler(m, sock, q, deviceId);
        return;
      }

      if (["berapa", "howmuch", "howmany"].includes(command || "")) {
        await berapaHandler(m, sock, q, deviceId);
        return;
      }

      if (["bagaimana", "gimana", "how"].includes(command || "")) {
        await bagaimanaHandler(m, sock, q, deviceId);
        return;
      }

      if (["apakah", "apa"].includes(command || "")) {
        await apakahHandler(m, sock, q, deviceId);
        return;
      }

      if (["translate", "tr"].includes(command || "")) {
        await translateHandler(m, sock, q, deviceId);
        return;
      }

      if (["kalkulatormlbb", "kalkulatorwr", "wrmlbb", "countwrmlbb"].includes(command || "")) {
        await kalkulatorwrHandler(m, sock, q, deviceId);
        return;
      }

      if (["trackip", "cekip", "iptrack"].includes(command || "")) {
        await trackipHandler(m, sock, q, deviceId);
        return;
      }

      if (["jadwaltv", "tv", "tvjadwal"].includes(command || "")) {
        await jadwaltvHandler(m, sock, q, deviceId);
        return;
      }

      if (["jadwalbola", "bola"].includes(command || "")) {
        await jadwalbolaHandler(m, sock, deviceId);
        return;
      }

      if (["avengers"].includes(command || "")) {
        await avengersHandler(m, sock, q, deviceId);
        return;
      }

      if (["bear"].includes(command || "")) {
        await bearHandler(m, sock, q, deviceId);
        return;
      }

      if (["blackpink"].includes(command || "")) {
        await blackpinkHandler(m, sock, q, deviceId);
        return;
      }

      if (["cartoon-graffiti", "graffiti"].includes(command || "")) {
        await cartoonGraffitiHandler(m, sock, q, deviceId);
        return;
      }

      if (["comic"].includes(command || "")) {
        await comicHandler(m, sock, q, deviceId);
        return;
      }

      if (["glitch"].includes(command || "")) {
        await glitchHandler(m, sock, q, deviceId);
        return;
      }

      if (["mascot"].includes(command || "")) {
        await mascotHandler(m, sock, q, deviceId);
        return;
      }

      if (["naruto"].includes(command || "")) {
        await narutoHandler(m, sock, q, deviceId);
        return;
      }

      if (["pixel-glitch"].includes(command || "")) {
        await pixelGlitchHandler(m, sock, q, deviceId);
        return;
      }

      if (["pornhub"].includes(command || "")) {
        await pornhubHandler(m, sock, q, deviceId);
        return;
      }

      if (["blue-archive", "bluearchive", "ba"].includes(command || "")) {
        await blueArchiveHandler(m, sock, q, deviceId);
        return;
      }

      if (["cecan-china", "cecan-tiongkok"].includes(command || "")) {
        await cecanChinaHandler(m, sock, q, deviceId);
        return;
      }

      if (["pap"].includes(command || "")) {
        await papHandler(m, sock, q, deviceId);
        return;
      }

      if (["loli"].includes(command || "")) {
        await loliHandler(m, sock, q, deviceId);
        return;
      }

      if (["cecan-vietnam", "cecan-viet"].includes(command || "")) {
        await cecanVietnamHandler(m, sock, q, deviceId);
        return;
      }

      if (["cecan-thailand", "cecan-thai"].includes(command || "")) {
        await cecanThailandHandler(m, sock, q, deviceId);
        return;
      }

      if (["cecan-korea", "cecan-kor"].includes(command || "")) {
        await cecanKoreaHandler(m, sock, q, deviceId);
        return;
      }

      if (["cecan-japan", "cecan-jepang"].includes(command || "")) {
        await cecanJapanHandler(m, sock, q, deviceId);
        return;
      }

      if (["cecan-indo", "cecan-indonesia"].includes(command || "")) {
        await cecanIndoHandler(m, sock, q, deviceId);
        return;
      }

      if (["anime"].includes(command || "")) {
        await animeHandler(m, sock, q, deviceId);
        return;
      }

      if (["emojigif"].includes(command || "")) {
        await emojigifHandler(m, sock, q, deviceId);
        return;
      }

      if (["fbdown", "facebookdl", "fb", "facebook"].includes(command || "")) {
        await facebookdlHandler(m, sock, q, deviceId);
        return;
      }

      if (["ttmp3", "ttmusic", "tiktokmusic"].includes(command || "")) {
        const url = args[0]?.trim();

        if (!url) {
          return reply(
            `🎵 *TɪᴋTᴏᴋ MP3*\n\n> Masukkan link video TikTok untuk mengambil audionya saja\n\n\`Contoh: ${prefix}${command} https://vt.tiktok.com/xxxx\``,
          );
        }

        if (!url.match(/tiktok\.com|vt\.tiktok/i)) {
          return reply("❌ URL tidak valid. Gunakan link TikTok.");
        }

        await react("🕕");
        try {
          const result = await ttdown_musical(url);
          const music = result.downloads.find((d: any) => d.type === "mp3");

          if (!music || !music.url) {
            await react("❌");
            return reply("❌ Audio TikTok tidak ditemukan.");
          }

          await send(
            {
              audio: { url: music.url },
              mimetype: "audio/mpeg",
              fileName: `TikTok_Audio_${Date.now()}.mp3`,
              contextInfo: {
                externalAdReply: {
                  title: result.title || "TikTok Music",
                  body: `👤 By: ${result.author.username || "-"}`,
                  thumbnailUrl: result.author?.avatar || result.cover,
                  sourceUrl: url,
                  mediaType: 2,
                  renderLargerThumbnail: false,
                },
              },
            },
            {}
          );

          await react("✅");
        } catch (err: any) {
          console.error("[TikTokMP3] Error:", err.message);
          await react("❌");
          return await reply(
            `❌ Halo ${m.pushName || "Unknown"}, terjadi kesalahan saat menjalankan command ${prefix}${command}:\n\n> ${err.message}`,
          );
        }
        return;
      }

      if (["autosholat", "sholat", "autoadzan"].includes(command || "")) {
        if (!isOwner) return reply("❌ Fitur ini khusus untuk Owner.");
        const database = getDatabase();
        if (!args[0] || args[0] === "status") {
          const settings = await database.getSettings();
          const status = settings.autoSholat ? "✅ Aktif" : "❌ Nonaktif";
          const closeGroup = settings.autoSholatCloseGroup ? "✅ Ya" : "❌ Tidak";
          const duration = settings.autoSholatDuration || 5;
          const kotaSetting = settings.autoSholatKota || { id: "1301", nama: "KOTA JAKARTA" };
          let jadwalText = "";
          try {
            const jadwalData = await getTodaySchedule(kotaSetting.id);
            const times = extractPrayerTimes(jadwalData);
            for (const [nama, waktu] of Object.entries(times)) {
              jadwalText += `┃ ${nama.charAt(0).toUpperCase() + nama.slice(1)}: \`${waktu}\`\n`;
            }
          } catch {
            jadwalText = "┃ _Gagal memuat jadwal_\n";
          }
          return reply(
            `🕌 *ᴀᴜᴛᴏ sʜᴏʟᴀᴛ*\n\n` +
            `╭┈┈⬡「 📋 *sᴛᴀᴛᴜs* 」\n` +
            `┃ 🔔 ᴀᴜᴛᴏ sʜᴏʟᴀᴛ: ${status}\n` +
            `┃ 🔒 ᴛᴜᴛᴜᴘ ɢʀᴜᴘ: ${closeGroup}\n` +
            `┃ ⏱️ ᴅᴜʀᴀsɪ: \`${duration}\` menit\n` +
            `┃ 📍 ᴋᴏᴛᴀ: \`${kotaSetting.nama}\`\n` +
            `╰┈┈⬡\n\n` +
            `╭┈┈⬡「 🕐 *ᴊᴀᴅᴡᴀʟ ʜᴀʀɪ ɪɴɪ* 」\n` +
            jadwalText +
            `╰┈┈⬡\n\n` +
            `💡 *ᴄᴀʀᴀ ᴘᴇɴɢɢᴜɴᴀᴀɴ:*\n` +
            `> \`${prefix}autosholat on/off\`: Mengaktifkan atau menonaktifkan fitur secara global.\n` +
            `> \`${prefix}autosholat kota <nama>\`: Mengatur lokasi kota untuk jadwal sholat (contoh: ${prefix}autosholat kota Jakarta).\n` +
            `> \`${prefix}autosholat close on/off\`: Mengatur apakah grup otomatis ditutup saat waktu sholat tiba.\n` +
            `> \`${prefix}autosholat duration <menit>\`: Mengatur durasi penutupan grup (default 5 menit).\n` +
            `> \`${prefix}autosholat status\`: Melihat status konfigurasi saat ini.\n\n` +
            `> _Sumber: myquran.com (real-time)_`
          );
        }
        if (args[0] === "on") {
          database.setSettings({ autoSholat: true });
          await react("✅");
          const kota = (await database.getSettings()).autoSholatKota || { id: "1301", nama: "KOTA JAKARTA" };
          return reply(`✅ *ᴀᴜᴛᴏ sʜᴏʟᴀᴛ ᴅɪᴀᴋᴛɪꜰᴋᴀɴ*\n\n> Pengingat waktu sholat aktif\n> Lokasi: ${kota.nama}`);
        }
        if (args[0] === "off") {
          database.setSettings({ autoSholat: false });
          await react("❌");
          return reply("❌ *ᴀᴜᴛᴏ sʜᴏʟᴀᴛ ᴅɪɴᴏɴᴀᴋᴛɪꜰᴋᴀɴ*");
        }
        if (args[0] === "close") {
          const subArg = args[1]?.toLowerCase();
          if (subArg === "on") {
            database.setSettings({ autoSholatCloseGroup: true });
            await react("🔒");
            return reply("🔒 *ᴛᴜᴛᴜᴘ ɢʀᴜᴘ ᴅɪᴀᴋᴛɪꜰᴋᴀɴ*\n\n> Grup akan ditutup saat waktu sholat");
          }
          if (subArg === "off") {
            database.setSettings({ autoSholatCloseGroup: false });
            await react("🔓");
            return reply("🔓 *ᴛᴜᴛᴜᴘ ɢʀᴜᴘ ᴅɪɴᴏɴᴀᴋᴛɪꜰᴋᴀɴ*\n\n> Grup tidak akan ditutup saat waktu sholat");
          }
          return reply(`❌ Gunakan: \`${prefix}autosholat close on/off\``);
        }
        if (args[0] === "duration") {
          const duration = parseInt(args[1]);
          if (isNaN(duration) || duration < 1 || duration > 60) return reply("❌ Durasi harus 1-60 menit");
          database.setSettings({ autoSholatDuration: duration });
          await react("⏱️");
          return reply(`⏱️ Durasi diset ke ${duration} menit.`);
        }
        if (args[0] === "kota") {
          const kotaName = args.slice(1).join(" ").trim();
          if (!kotaName) return reply("❌ Masukkan nama kota.");
          await react("🔍");
          const res = await searchKota(kotaName);
          if (!res) return reply("❌ Kota tidak ditemukan.");
          database.setSettings({ autoSholatKota: { id: res.id, nama: res.lokasi } });
          await react("📍");
          return reply(`📍 Lokasi diset ke *${res.lokasi}*`);
        }
        return;
      }


      if (["hidetag2", "h2", "ht2"].includes(command || "")) {
        await react("📢");
        if (!isGroup) return reply("❌ *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Fitur ini hanya dapat digunakan di dalam grup!");
        const groupMetadata = await sock.groupMetadata(m.key.remoteJid!);
        const participants = groupMetadata.participants || [];
        const sender = m.key.participant || m.key.remoteJid || "";
        const isAdmin = participants.find(p => p.id === sender)?.admin;
        if (!isAdmin && !m.key.fromMe) return reply("❌ *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Fitur ini khusus untuk Admin Grup!");
        
        const mentions = participants.map(p => p.id);
        const text = q?.trim() || "";

        const fakeQuoted = {
            ...getVerifiedQuoted({ bot: { name: 'CMNTY-BOT' } }),
            message: {
                ...getVerifiedQuoted({ bot: { name: 'CMNTY-BOT' } }).message,
                'conversation': 'CMNTY-BOT',
                'forwardedNewsletterMessageInfo': forwardedNewsletterMessageInfo
            }
        };

        try {
            if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
              const qMsg = m.message.extendedTextMessage.contextInfo.quotedMessage;
              const type = Object.keys(qMsg)[0];
              
              if (type === "imageMessage") {
                const stream = await downloadContentFromMessage(qMsg.imageMessage!, "image");
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                await sock.sendMessage(m.key.remoteJid!, { image: buffer, caption: qMsg.imageMessage?.caption || text, mentions }, { quoted: fakeQuoted });
              } else if (type === "videoMessage") {
                const stream = await downloadContentFromMessage(qMsg.videoMessage!, "video");
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                await sock.sendMessage(m.key.remoteJid!, { video: buffer, caption: qMsg.videoMessage?.caption || text, mentions }, { quoted: fakeQuoted });
              } else if (type === "stickerMessage") {
                const stream = await downloadContentFromMessage(qMsg.stickerMessage!, "sticker");
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                await sock.sendMessage(m.key.remoteJid!, { sticker: buffer, mentions }, { quoted: fakeQuoted });
              } else if (type === "audioMessage") {
                const stream = await downloadContentFromMessage(qMsg.audioMessage!, "audio");
                let buffer = Buffer.from([]);
                for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
                await sock.sendMessage(m.key.remoteJid!, { audio: buffer, mentions, mimetype: qMsg.audioMessage?.mimetype || 'audio/mp4' }, { quoted: fakeQuoted });
              } else {
                const quotedText = qMsg.conversation || qMsg.extendedTextMessage?.text || "";
                await sock.sendMessage(m.key.remoteJid!, { text: quotedText || text, mentions }, { quoted: fakeQuoted });
              }
            } else {
              if (!text) return reply(`📢 *HIDETAG 2*\n\n• \`${prefix}h2 <text>\`\n• Reply pesan + \`${prefix}h2\``);
              await sock.sendMessage(m.key.remoteJid!, { text, mentions }, { quoted: fakeQuoted });
            }
            await react("✅");
        } catch (e: any) {
            await react("☢");
            reply(`❌ Gagal: ${e.message}`);
        }
        return;
      }

      if (["opentime"].includes(command || "")) {
          if (!isGroup) return reply("❌ Hanya untuk grup.");
          if (!isAdmin) return reply("❌ Admin saja.");
          const time = q?.trim();
          if (!time) return reply(`❌ Gunakan: \`${prefix}opentime 06.00\`\n\n> Kamu bisa set lebih dari satu waktu dipisah koma, contoh: \`${prefix}opentime 06.00, 12.00\``);
          
          const times = time.split(',').map(t => formatTime(t.trim())).filter((t): t is string => !!t);
          if (times.length === 0) return reply(`❌ Format salah! Gunakan format HH.mm (contoh: 06.00)`);
          
          const db = getDatabase();
          const groupData = await db.getGroup(m.key.remoteJid!) || { id: m.key.remoteJid! };
          groupData.opentime = times.join(',');
          await db.setGroup(m.key.remoteJid!, groupData);
          await react("✅");
          return reply(`✅ *ᴏᴘᴇɴᴛɪᴍᴇ ᴛᴇʟᴀʜ ᴅɪsᴇᴛ*\n\n> Grup akan dibuka otomatis setiap jam: *${times.join(', ')}*`);
      }

      if (["closetime"].includes(command || "")) {
          if (!isGroup) return reply("❌ Hanya untuk grup.");
          if (!isAdmin) return reply("❌ Admin saja.");
          const time = q?.trim();
          if (!time) return reply(`❌ Gunakan: \`${prefix}closetime 21.00\`\n\n> Kamu bisa set lebih dari satu waktu dipisah koma, contoh: \`${prefix}closetime 21.00, 00.00\``);
          
          const times = time.split(',').map(t => formatTime(t.trim())).filter((t): t is string => !!t);
          if (times.length === 0) return reply(`❌ Format salah! Gunakan format HH.mm (contoh: 21.00)`);
          
          const db = getDatabase();
          const groupData = await db.getGroup(m.key.remoteJid!) || { id: m.key.remoteJid! };
          groupData.closetime = times.join(',');
          await db.setGroup(m.key.remoteJid!, groupData);
          await react("🔒");
          return reply(`🔒 *ᴄʟᴏsᴇᴛɪᴍᴇ ᴛᴇʟᴀʜ ᴅɪsᴇᴛ*\n\n> Grup akan ditutup otomatis setiap jam: *${times.join(', ')}*`);
      }
      
      if (["cektime"].includes(command || "")) {
          if (!isGroup) return reply("❌ Hanya untuk grup.");
          const db = getDatabase();
          const groupData = await db.getGroup(m.key.remoteJid!) || { id: m.key.remoteJid! };
          return reply(`⏰ *JADWAL GRUP*\n\n> 🔓 Open: *${groupData.opentime || 'Tidak diset'}*\n> 🔒 Close: *${groupData.closetime || 'Tidak diset'}*`);
      }
      
      if (["delopentime"].includes(command || "")) {
          if (!isGroup) return reply("❌ Hanya untuk grup.");
          if (!isAdmin) return reply("❌ Admin saja.");
          const db = getDatabase();
          const groupData = await db.getGroup(m.key.remoteJid!) || { id: m.key.remoteJid! };
          await db.setGroup(m.key.remoteJid!, { opentime: "" });
          await react("✅");
          return reply(`✅ *ᴏᴘᴇɴᴛɪᴍᴇ ᴅɪʜᴀᴘᴜs*`);
      }
      
      if (["delclosetime"].includes(command || "")) {
          if (!isGroup) return reply("❌ Hanya untuk grup.");
          if (!isAdmin) return reply("❌ Admin saja.");
          const db = getDatabase();
          const groupData = await db.getGroup(m.key.remoteJid!) || { id: m.key.remoteJid! };
          await db.setGroup(m.key.remoteJid!, { closetime: "" });
          await react("🔒");
          return reply(`🔒 *ᴄʟᴏsᴇᴛɪᴍᴇ ᴅɪʜᴀᴘᴜs*`);
      }

      if (["ht", "hidetag", "h"].includes(command || "")) {
        await react("📢");
        if (!isGroup) return reply("❌ *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Fitur ini hanya dapat digunakan di dalam grup!");
        
        // Cek admin
        const groupMetadata = await sock.groupMetadata(m.key.remoteJid!);
        const participants = groupMetadata.participants || [];
        const sender = m.key.participant || m.key.remoteJid || "";
        const isAdmin = participants.find(p => p.id === sender)?.admin;
        const isBotAdmin = participants.find(p => p.id === sock.user?.id)?.admin;

        if (!isAdmin && !m.key.fromMe) return reply("❌ *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Fitur ini khusus untuk Admin Grup!");

        const mentions = participants.map(p => p.id);
        const text = q?.trim() || "";

        try {
          if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
            const quoted = m.message.extendedTextMessage.contextInfo;
            const qMsg = quoted.quotedMessage!;
            const type = Object.keys(qMsg)[0];

            // IMAGE
            if (type === "imageMessage") {
              const stream = await downloadContentFromMessage(qMsg.imageMessage!, "image");
              let buffer = Buffer.from([]);
              for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
              return await sock.sendMessage(m.key.remoteJid!, { 
                image: buffer, 
                caption: qMsg.imageMessage?.caption || text, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
            }

            // VIDEO
            if (type === "videoMessage") {
              const stream = await downloadContentFromMessage(qMsg.videoMessage!, "video");
              let buffer = Buffer.from([]);
              for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
              return await sock.sendMessage(m.key.remoteJid!, { 
                video: buffer, 
                caption: qMsg.videoMessage?.caption || text, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
            }

            // STICKER
            if (type === "stickerMessage") {
              const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net';
              if (m.key.remoteJid === botId) return;

              const stream = await downloadContentFromMessage(qMsg.stickerMessage!, "sticker");
              let buffer = Buffer.from([]);
              for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
              await sock.sendMessage(m.key.remoteJid!, { 
                sticker: buffer, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
              
              if (text) await sock.sendMessage(m.key.remoteJid!, { 
                text, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
              return;
            }

            // AUDIO
            if (type === "audioMessage") {
              const stream = await downloadContentFromMessage(qMsg.audioMessage!, "audio");
              let buffer = Buffer.from([]);
              for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
              await sock.sendMessage(m.key.remoteJid!, { 
                audio: buffer, 
                mimetype: qMsg.audioMessage?.mimetype, 
                ptt: qMsg.audioMessage?.ptt, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
              if (text) await sock.sendMessage(m.key.remoteJid!, { 
                text, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
              return;
            }

            // DOCUMENT
            if (type === "documentMessage") {
              const stream = await downloadContentFromMessage(qMsg.documentMessage!, "document");
              let buffer = Buffer.from([]);
              for await (const chunk of stream) { buffer = Buffer.concat([buffer, chunk]); }
              await sock.sendMessage(m.key.remoteJid!, { 
                document: buffer, 
                mimetype: qMsg.documentMessage?.mimetype, 
                fileName: qMsg.documentMessage?.fileName, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
              if (text) await sock.sendMessage(m.key.remoteJid!, { 
                text, 
                mentions,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) });
              return;
            }

            // TEXT REPLY
            const quotedText = qMsg.conversation || qMsg.extendedTextMessage?.text || "";
            const finalText = text || quotedText;
            if (!finalText) return reply("❌ *ᴘᴇsᴀɴ ᴋᴏsᴏɴɢ*\n\n> Masukkan teks atau balas pesan yang ingin di tag!");
            return await sock.sendMessage(m.key.remoteJid!, { 
              text: finalText, 
              mentions,
              contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) });
          }

          if (!text) {
            return reply(`❌ *ᴘᴇɴɢɢᴜɴᴀᴀɴ sᴀʟᴀʜ*\n\n> Contoh: ${prefix}${command} Info`);
          }

          await sock.sendMessage(m.key.remoteJid!, { 
            text, 
            mentions,
            contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: getVerifiedQuoted(deviceConfig) });
        } catch (e: any) {
          console.error("[Hidetag Error]:", e.message);
          reply(`❌ *ᴛᴇʀᴊᴀᴅɪ ᴋᴇsᴀʟᴀʜᴀɴ*\n\n> ${e.message}`);
        }
        return;
      }

      if (["spamngl", "nglspam"].includes(command || "")) {
        const parts = q?.split("|");
        const link = parts?.[0]?.trim();
        const kata = parts?.[1]?.trim();
        const jumlahRaw = parts?.[2]?.trim();
        const jumlah = parseInt(jumlahRaw || "0");

        if (!link || !kata || !jumlahRaw) {
          return reply(`📧 *NGL Sᴘᴀᴍᴍᴇʀ*\n\n> Masukkan link NGL, pesan, dan jumlah spam yang diinginkan\n\n\`Contoh: ${prefix}${command} https://ngl.link/xxxx | Halo | 5\``);
        }

        if (isNaN(jumlah) || jumlah <= 0) {
          return reply("❌ Jumlah harus berupa angka positif.");
        }
        
        if (jumlah > 25) {
          return reply("⚠️ Batas maksimal adalah 25 pesan sekali kirim demi keamanan.");
        }

        await react("🎴");
        reply(`🚀 *Sᴛᴀʀᴛɪɴɢ Sᴘᴀᴍ...*\n\n> Target: ${link}\n> Pesan: ${kata}\n> Jumlah: ${jumlah}\n\n_Harap tunggu sampai selesai..._`);

        try {
          for (let i = 0; i < jumlah; i++) {
            axios.get(`https://api.cuki.biz.id/api/tools/sendngl?apikey=cuki-x&link=${encodeURIComponent(link)}&text=${encodeURIComponent(kata)}`, {
              timeout: 15000
            }).catch(() => {});
            if (i < jumlah - 1) await new Promise(resolve => setTimeout(resolve, 3000));
          }
          
          await react("✅");
          return reply(`✨ *SPAM DONE!* ✅\n\nBerhasil mengirim ${jumlah} pesan ke *${link}*`);
        } catch (e: any) {
          console.error("[NGL Spam Error]:", e.message);
          await react("❌");
          reply(`❌ Terjadi kesalahan: ${e.message}`);
        }
        return;
      }


      if (["spamotp", "otp"].includes(command || "")) {
        const nomer = q?.trim();
        if (!nomer) {
          return reply(
            `📲 *Sᴘᴀᴍ OTP*\n\n` +
            `> Masukkan nomor telepon target!\n\n` +
            `\`Contoh: ${prefix}${command} 08123456789\``
          );
        }

        await react("🕕");
        reply(`🚀 *Mᴇɴɢɪʀɪᴍ OTP sᴘᴀᴍ...*\n\n> Target: \`${nomer}\`\n\n_Harap tunggu sebentar..._`);

        try {
          const { data } = await axios.get(`https://api.cmnty.web.id/tools/spam-otp?nomer=${encodeURIComponent(nomer)}`);
          
          let responseDetail = "";
          if (typeof data === "string") {
            responseDetail = data;
          } else if (data && typeof data === "object") {
            responseDetail = data.message || data.result || JSON.stringify(data);
          } else {
            responseDetail = JSON.stringify(data);
          }

          await react("✅");
          return reply(`✨ *SPAM OTP BERHASIL!* ✅\n\n> Target: \`${nomer}\`\n> Response: ${responseDetail}`);
        } catch (e: any) {
          console.error("[Spam OTP Error]:", e.message);
          await react("❌");
          reply(`❌ Gagal mengirim spam OTP ke \`${nomer}\`.\n\nDetail: ${e.message}`);
        }
        return;
      }


      if (["webtoapk", "web2apk"].includes(command || "")) {
        const parts = q?.split("|");
        const url = parts?.[0]?.trim();
        const name = parts?.[1]?.trim();
        const pkg = parts?.[2]?.trim();
        const icon = parts?.[3]?.trim();

        if (!url || !name || !pkg || !icon) {
          return reply(
            `📲 *ᴡᴇʙ TO APK*\n\n` +
            `> Ubah website menjadi file aplikasi Android (APK)!\n\n` +
            `> *Format:* ${prefix}${command} url | nama_app | nama_package | link_icon\n\n` +
            `> *Contoh:*\n` +
            `\`${prefix}${command} https://google.com | Google App | com.google.app | https://google.com/favicon.ico\``
          );
        }

        await react("🕕");
        reply(`🚀 *Sedang memproses konversi Web ke APK...*\n\n> URL: ${url}\n> Nama: ${name}\n> Package: ${pkg}\n> Icon: ${icon}\n\n_Proses ini memakan waktu, harap tunggu sebentar..._`);

        try {
          const apiUrl = `https://api.cmnty.web.id/tools/web2apk?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}&package=${encodeURIComponent(pkg)}&icon=${encodeURIComponent(icon)}`;
          const response = await axios.get(apiUrl, { responseType: "arraybuffer", timeout: 120000 });
          const contentType = response.headers["content-type"] || "";
          const buffer = Buffer.from(response.data);

          if (String(contentType).includes("application/json")) {
            const text = buffer.toString("utf-8");
            const json = JSON.parse(text);
            if (json.status && json.result?.downloadUrl) {
              await react("✅");
              await sock.sendMessage(m.key.remoteJid!, {
                document: { url: json.result.downloadUrl },
                mimetype: "application/vnd.android.package-archive",
                fileName: `${name.replace(/[^a-zA-Z0-9]/g, "_")}.apk`,
                contextInfo: getContextInfo(deviceConfig, m)
              }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            } else {
              await react("❌");
              return reply(`❌ Gagal konversi: ${json.message || json.result || text}`);
            }
          } else {
            await react("✅");
            await sock.sendMessage(m.key.remoteJid!, {
              document: buffer,
              mimetype: "application/vnd.android.package-archive",
              fileName: `${name.replace(/[^a-zA-Z0-9]/g, "_")}.apk`,
              contextInfo: getContextInfo(deviceConfig, m)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          }
        } catch (e: any) {
          console.error("[WebToApk Error]:", e.message);
          await react("❌");
          reply(`❌ Gagal mengubah Web ke APK.\n\nDetail: ${e.message}`);
        }
        return;
      }


      if (["pins", "pinterest", "pinsearch"].includes(command || "")) {
        const query = q?.trim();
        if (!query) {
          return reply(
            `🔍 *ᴘɪɴᴛᴇʀᴇsᴛ sᴇᴀʀᴄʜ*\n\n` +
            `> Contoh:\n` +
            `\`${prefix}pins Zhao Lusi\``
          );
        }
        await react("🕕");

        try {
          const { data } = await axios.get(`https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(query)}`);
          
          const results = data?.data?.slice(0, 5);
          if (!results || results.length === 0) {
            await react("❌");
            return reply(`❌ Tidak ditemukan hasil untuk: ${query}`);
          }

          const mediaList = results.map((item: any) => {
            const imageUrl = item.image_url || item.url || item.grid_image || item.grid_title;
            if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
              return { image: { url: imageUrl } };
            }
            return null;
          }).filter((m: any) => m !== null);

          if (mediaList.length === 0) {
            await react("❌");
            return reply('❌ Gagal memuat gambar');
          }

          try {
            await sock.sendMessage(m.key.remoteJid!, {
              albumMessage: mediaList
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            await react("✅");
          } catch (err) {
            console.log('[Pins] Album gagal, kirim satu-satu:', err.message);
            for (const content of mediaList) {
              await sock.sendMessage(m.key.remoteJid!, content, { quoted: getVerifiedQuoted(deviceConfig) as any });
              await new Promise(r => setTimeout(r, 500));
            }
            await react("✅");
          }
        } catch (err: any) {
          console.error('[Pins] Error:', err.message);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }


      if (["npm", "npmsearch", "npmjs", "npmfind"].includes(command || "")) {
        const query = q?.trim();
        if (!query) {
          return reply(
            `*─── [ NPM SEARCH ] ───*\n\n` +
            `Format salah! Gunakan:\n` +
            `> \`${prefix + command} <nama_package>\`\n\n` +
            `Contoh:\n` +
            `> \`${prefix + command} cheerio\``
          );
        }

        await react("🔍");

        try {
          const response = await fetch(`https://registry.npmjs.com/-/v1/search?text=${encodeURIComponent(query)}&size=10`);
          if (!response.ok) throw new Error("Gagal terhubung ke NPM Registry");

          const data: any = await response.json();
          if (!data.objects || data.objects.length === 0) {
            await react("❌");
            return reply(`❌ Package *"${query}"* tidak ditemukan di NPM Registry.`);
          }

          let text = `📦 *ɴᴘᴍ sᴇᴀʀᴄʜ ʀᴇsᴜʟᴛs*\n`;
          text += `🔍 Query: \`${query}\`\n`;
          text += `📊 Total: ${data.total} packages\n`;
          text += `────────────────────\n\n`;

          data.objects.slice(0, 5).forEach((item: any, i: number) => {
            const pkg = item.package;
            const score = item.score;
            const lastPublish = pkg.date ? new Date(pkg.date).toLocaleDateString("id-ID") : "Unknown";
            const maintenance = Math.round((score?.detail?.maintenance || 0) * 100);

            text += `*${i + 1}. ${pkg.name}* (v${pkg.version})\n`;
            text += `📝 _${pkg.description?.slice(0, 80) || "No description"}..._\n`;
            text += `👤 Author: ${pkg.publisher?.username || pkg.author?.name || "Unknown"}\n`;
            text += `📅 Update: ${lastPublish}\n`;
            text += `🔗 _${pkg.links?.npm}_\n`;
            text += `🛠️ Maintenance: ${maintenance}%\n\n`;
          });

          text += `_Ketik ${prefix}npm <nama> untuk hasil lebih spesifik._`;

          await react("✅");

          await sock.sendMessage(m.key.remoteJid!, {
            text: text,
            contextInfo: getContextInfo(deviceConfig, m, null, true, true, false)
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

        } catch (e: any) {
          console.error("[NPM Search Error]:", e.message);
          await react("❌");
          reply(`❌ Terjadi kesalahan: ${e.message}`);
        }
        return;
      }

      if (["githubdl", "gitdl", "gitclone", "repodownload"].includes(command || "")) {
        let username, repo, branch;
        
        if (args[0]?.includes('github.com')) {
            const urlMatch = args[0].match(/github\.com\/([^\/]+)\/([^\/]+)/i);
            if (urlMatch) {
                username = urlMatch[1];
                repo = urlMatch[2].replace(/\.git$/, '');
                branch = args[1] || '';
            }
        } else {
            username = args[0];
            repo = args[1];
            branch = args[2] || '';
        }
        
        if (!username) {
            return reply(
                `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n` +
                `> \`${prefix}githubdl <user> <repo> <branch>\`\n\n` +
                `> Contoh:\n` +
                `> \`${prefix}githubdl niceplugin NiceBot main\`\n` +
                `> \`${prefix}githubdl https://github.com/user/repo\``
            );
        }
        
        if (!repo) {
            return reply(`❌ *ʀᴇᴘᴏ ᴅɪʙᴜᴛᴜʜᴋᴀɴ*\n\n> Masukkan nama repository`);
        }
        
        await react('🕕');

        try {
            const repoInfo = await axios.get(`https://api.github.com/repos/${username}/${repo}`, { validateStatus: () => true });
            
            if (repoInfo.status !== 200) {
                await react('❌');
                return reply(`❌ *ʀᴇᴘᴏ ᴛɪᴅᴀᴋ ᴅɪᴛᴇᴍᴜᴋᴀɴ*\n\n> \`${username}/${repo}\` tidak ada`);
            }
            
            const repoData = repoInfo.data;
            const defaultBranch = repoData.default_branch || 'main';
            branch = branch || defaultBranch;
            
            const zipUrl = `https://github.com/${username}/${repo}/archive/refs/heads/${branch}.zip`;
            
            const checkRes = await axios.head(zipUrl, { validateStatus: () => true });
            if (checkRes.status >= 400) {
                await react('❌');
                return reply(`❌ *ʙʀᴀɴᴄʜ ᴛɪᴅᴀᴋ ᴀᴅᴀ*\n\n> Branch \`${branch}\` tidak ditemukan\n> Default: \`${defaultBranch}\``);
            }
            
            const vQuoted = getVerifiedQuoted(deviceConfig);
            await sock.sendMessage(chatId, {
                document: { url: zipUrl },
                fileName: `${repo} - Branch: ${branch}.zip`,
                mimetype: 'application/zip',
                caption: `✅ *GɪᴛHᴜʙ Rᴇᴘᴏ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Repo: ${repo}\n> Branch: ${branch}`,
                contextInfo: getContextInfo(deviceConfig, m, null, true, true, true)
            }, { quoted: vQuoted as any });
            
            await react('✅');
            
        } catch (e: any) {
            console.error("[GithubDL Error]:", e.message);
            await react('☢️');
            reply(`❌ Terjadi kesalahan: ${e.message}`);
        }
        return;
      }

      if (["capcutdl", "ccdl", "capcut", "cc"].includes(command || "")) {
        const url = q?.trim();
        
        if (!url) {
            return reply(
                `⚠️ *CᴀᴘCᴜᴛ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n` +
                `> \`${prefix}ccdl <url>\`\n\n` +
                `> Contoh:\n` +
                `> \`${prefix}ccdl https://www.capcut.com/t/xxx\``
            );
        }
        
        if (!url.match(/capcut\.com/i)) {
            return reply(`❌ URL tidak valid. Gunakan link CapCut.`);
        }
        
        await react("🕕");
        
        try {
            const data = await capcut(url);
            
            if (!data?.status || !data?.originalVideoUrl) {
                await react("❌");
                return reply(`❌ Gagal mengambil video. Coba link lain.`);
            }
            
            await sock.sendMessage(m.key.remoteJid!, {
                video: { url: data.originalVideoUrl },
                caption: `✅ *CᴀᴘCᴜᴛ Dᴏᴡɴʟᴏᴀᴅᴇʀ*`,
                contextInfo: getContextInfo(deviceConfig, m, null, true, true, true)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
            await react("✅");
            
        } catch (err: any) {
            console.error("[CapCut Error]:", err.message);
            await react("☢️");
            reply(`❌ Terjadi kesalahan: ${err.message}`);
        }
        return;
      }

      if (["ig", "instagram"].includes(command || "")) {
        const url = q?.trim();
        if (!url || !url.includes("instagram.com")) {
          return reply(`📸 *Iɴsᴛᴀɢʀᴀᴍ Dᴏᴡɴʟᴏᴀᴅᴇʀ*\n\n> Masukkan link postingan atau reels Instagram\n\n\`Contoh: ${prefix}${command} https://www.instagram.com/reels/...\``);
        }

        await react("⏳");
        try {
          const res: any = await axios.get(`https://api.neoxr.eu/api/ig?url=${encodeURIComponent(url)}&apikey=${config.neoxrApiKey || 'CMNTY-BOT'}`);
          if (!res.data.status) throw new Error(res.data.msg || "Gagal mengambil data");
          
          const media = res.data.data;
          for (const item of media) {
            await sock.sendMessage(m.key.remoteJid!, {
              [item.type === "video" ? "video" : "image"]: { url: item.url },
              caption: `✨ *Iɴsᴛᴀɢʀᴀᴍ Dᴏᴡɴʟᴏᴀᴅᴇ Lɪᴛᴇ*\n\n> Type: ${item.type.toUpperCase()}`,
              contextInfo: getContextInfo(deviceConfig, m, null, true, true, true)
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          }
          await react("✅");
        } catch (e: any) {
          console.error("[IG Download Error]:", e.message);
          await react("❌");
          reply(`❌ Terjadi kesalahan: ${e.message}`);
        }
        return;
      }


      if (["ytplay", "play", "playmp3"].includes(command || "")) {
        const query = args.join(" ");
        if (!query) {
          return reply(
            `🎵 *YOUTUBE PLAY*\n\n> Masukkan judul lagu atau link YouTube\n\n\`Contoh: ${prefix}ytplay duka\``,
          );
        }

        await react("🕕");
        try {
          const searchResults = await yts(query);
          const video = searchResults.videos[0];
          
          if (!video) {
            await react("❌");
            return reply("❌ Lagu atau video tidak ditemukan di YouTube.");
          }

          // Fast Parallel Downloading logic
          const controller = new AbortController();
          const signal = controller.signal;

          const fetchNexRay = async () => {
             const res = await axios.get(`https://api.nexray.web.id/downloader/ytmp3?url=${encodeURIComponent(video.url)}`, { signal, timeout: 25000 });
             if (res.data?.status && res.data?.result?.url) return res.data.result.url;
             throw new Error("NexRay failed");
          };

          const fetchFallback = async () => {
             const res = await getAudioDownload(video.url);
             if (res?.download) return res.download;
             throw new Error("Fallback failed");
          };

          let finalAudioUrl: string | null = null;
          try {
             // Race all APIs, take the first success
             finalAudioUrl = await Promise.any([
                fetchNexRay(),
                fetchFallback()
             ]);
             controller.abort(); // Cancel other pending requests
          } catch (e: any) {
             console.error("[Play Racer Error]:", e.message);
             await react("❌");
             return reply("❌ Semua server download sedang sibuk atau tidak tersedia. Silahkan coba lagi nanti.");
          }

          if (!finalAudioUrl) {
             await react("❌");
             return reply("❌ Gagal mendapatkan URL audio.");
          }

          // Download buffer first to ensure stability and avoid Connection Closed errors
          let audioBuffer;
          try {
            const audioRes = await axios.get(finalAudioUrl, { 
              responseType: 'arraybuffer', 
              timeout: 45000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
          });
          if (!audioRes.data) throw new Error("Gagal mengunduh audio: Data kosong");
          audioBuffer = Buffer.from(audioRes.data);
          } catch (e: any) {
            console.error("[Download Error]:", e.message);
            throw new Error(`Gagal mengunduh konten audio dari server: ${e.message}`);
          }

          if (!sock) return;

          await send(
            {
              audio: audioBuffer,
              mimetype: "audio/mpeg",
              fileName: video.title + ".mp3",
            },
            {}
          );
          
          await react("✅");
        } catch (err: any) {
           console.error("[Play] Error:", err.message);
           await react("❌");
           return reply(`❌ Terjadi kesalahan saat memproses lagu: ${err.message}`);
        }
        return;
      }

      if (["ytplayvid", "playvid", "playmp4"].includes(command || "")) {
        const query = q;
        if (!query) {
          return reply(
            `🎬 *YOUTUBE PLAY VIDEO*\n\n> Masukkan judul video atau link YouTube\n\n\`Contoh: ${prefix}${command} duka\``,
          );
        }

        await react("🕕");
        try {
          const searchResults = await yts(query);
          const video = searchResults.videos[0];
          
          if (!video) {
            await react("❌");
            return reply("❌ Video tidak ditemukan di YouTube.");
          }

          const downloadUrl = await getVideoDownloadUrl(video.url);
          const quoted = getVerifiedQuoted(deviceConfig);
          
          await sock.sendMessage(m.key.remoteJid!, {
            video: { url: downloadUrl },
            caption: `🎬 *YOUTUBE PLAY VIDEO*\n\n✅ *Judul:* ${video.title}\n🔗 *Link:* ${video.url}\n\n> Berhasil mengunduh video anda.`,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                forwardingScore: 99,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                  newsletterJid: "120363426467190619@newsletter",
                  newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                  serverMessageId: 1
                }
            }
          }, { quoted: quoted as any });
          await react("✅");
        } catch (err: any) {
          console.error("[YTPLAYVID]", err);
          await react("❌");
          reply(`❌ Gagal memutar video: ${err.message || err}`);
        }
        return;
      }

      if (["splay", "spotplay", "stifyplay", "sp"].includes(command || "")) {
        const query = args.join(" ");
        if (!query) {
          return reply(
            `🎵 *SPOTIFY PLAY*\n\n> Masukkan pencarian judul lagu / artis Spotify\n\n\`Contoh: ${prefix}splay duka\``,
          );
        }

        await react("🕕");
        try {
          const res = await axios.get(`https://api.nexray.web.id/downloader/spotifyplay?q=${encodeURIComponent(query)}`, { timeout: 30000 });
          
          if (!res.data?.result?.download_url) {
             throw new Error("Lagu tidak ditemukan atau download URL kosong.");
          }
          const result = res.data.result;

          // Download buffer first to ensure stability and avoid Connection Closed errors
          let audioBuffer;
          try {
            const audioRes = await axios.get(result.download_url, { 
              responseType: 'arraybuffer', 
              timeout: 45000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            });
            if (!audioRes.data) throw new Error("Data kosong");
            audioBuffer = Buffer.from(audioRes.data);
          } catch (e: any) {
            console.error("[Spotify Download Error]:", e.message);
            throw new Error(`Gagal mengunduh lagu: ${e.message}`);
          }

          if (!sock) return;

          await send(
            {
              audio: audioBuffer,
              mimetype: "audio/mpeg",
              ptt: false, // Make sure it's played as an audio file not VN if possible (baileys usually handles ptt flag)
              fileName: `${result.title || 'spotify'}.mp3`,
            },
            {}
          );
          
          await react("✅");
        } catch (err: any) {
           console.error("[Spotify Play] Error:", err.message);
           await react("❌");
           return reply(`❌ Gagal: ${err.message}`);
        }
        return;
      }

    if (["s", "sticker"].includes(command || "")) {
      await makeSticker(m, sock, deviceId);
      return;
    }

    if (["qc", "quotedsticker", "quotechat"].includes(command || "")) {
      await qcSticker(m, sock, args, deviceId);
      return;
    }


    if (["brat", "brats"].includes(command || "")) {
      await bratSticker(m, sock, q, deviceId);
      return;
    }

    if (["bratvid", "bratgif", "bratvideo"].includes(command || "")) {
      await bratVideoSticker(m, sock, q, deviceId);
      return;
    }

    
    if (["bratvermeil"].includes(command || "")) {
      await bratStickerVermeil(m, sock, q, deviceId);
      return;
    }

    if (["bratanime"].includes(command || "")) {
      await bratAnimeSticker(m, sock, q, deviceId);
      return;
    }

    if (["smeme", "memesticker", "memes"].includes(command || "")) {
      await smeme(m, sock, q, deviceId);
      return;
    }

    if (["attp"].includes(command || "")) {
      await attpMode(m, sock, q, deviceId);
      return;
    }

    if (["bratbahlil"].includes(command || "")) {
      await bratBahlilSticker(m, sock, q, deviceId);
      return;
    }

    if (["bratgreen", "brat2"].includes(command || "")) {
      await bratGreenSticker(m, sock, q, deviceId);
      return;
    }

    if (["bratcewek", "cewekbrat", "bratgirl"].includes(command || "")) {
      await bratCewekSticker(m, sock, q, deviceId);
      return;
    }

    if (["bratsquidward", "squidwardbrat"].includes(command || "")) {
      await bratSquidwardSticker(m, sock, q, deviceId);
      return;
    }

    if (["pinpack", "ppack", "pinsticker", "pinsearchpack"].includes(command || "")) {
      await pinpackMode(m, sock, q, deviceId);
      return;
    }

    if (["stickerpack", "sp", "stickersearch", "searchsticker"].includes(command || "")) {
      await stickerPackHandler(m, sock, q, deviceId);
      return;
    }

    if (["bratvid2", "bratvideo2", "bratgif2"].includes(command || "")) {
      await bratVidSticker(m, sock, q, deviceId);
      return;
    }

    if (["bratpatrick", "patrickbrat"].includes(command || "")) {
      await bratPatrickSticker(m, sock, q, deviceId);
      return;
    }

    if (["emojimix", "mixemoji", "emix"].includes(command || "")) {
      await emojiMixSticker(m, sock, q, deviceId);
      return;
    }

    if (["swm", "wm", "stickerwm", "stickermark", "colong"].includes(command || "")) {
      await swmSticker(m, sock, q, deviceId);
      return;
    }
    
    // .saweria and .tako handlers
    if (["saweria"].includes(command || "")) {
        await donateSaweria(m, sock, q, deviceId);
        return;
    }
    if (["tako"].includes(command || "")) {
        await donateTako(m, sock, q, deviceId);
        return;
    }

    if (["donasi", "donate", "suport"].includes(command || "")) {
      // Jika command adalah donate tapi ada argumen tako/saweria, biarkan handler bawah yang menangani
      if (command === "donate" && (q.startsWith("tako") || q.startsWith("saweria"))) {
         // Lanjut ke handler spesifik
      } else {
        const supportMsg = `😊 *DUKUNGAN, SUPORT & REQUEST FITUR*🥰

> Terimakasih untuk semua yang sudah mensuport developer cmnty bot, kedepannya kami akan mencoba lebih baik lagi dan menambahkan fitur-fitur baru yang lebih lengkap 

> ©ojicmnty-developer

*gunakan cmd ini untuk melakukan donasi*
\`.donate saweria\`
\`.donate tako\``;
        
        return sock.sendMessage(m.key.remoteJid!, { 
            text: supportMsg,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
      }
    }

    if (command === "donate" && q.startsWith("tako")) {
      await donateTako(m, sock, q.replace("tako", "").trim(), deviceId);
      return;
    }
    
    if (command === "donate" && q.startsWith("saweria")) {
      await donateSaweria(m, sock, q.replace("saweria", "").trim(), deviceId);
      return;
    }

    if (["to3d", "3d", "3dfy", "to3dmodel"].includes(command || "")) {
      await to3dMode(m, sock, deviceId);
      return;
    }

    if (["tochibi", "chibi", "chibistyle"].includes(command || "")) {
      await tochibiMode(m, sock, deviceId);
      return;
    }

    if (["toblack", "black", "hitamkan", "hitam", "tohitam"].includes(command || "")) {
      await toblackMode(m, sock, deviceId);
      return;
    }

    if (["susu"].includes(command || "")) {
      await susuMode(m, sock, deviceId);
      return;
    }

    if (["susutaro"].includes(command || "")) {
      await susuTaroMode(m, sock, deviceId);
      return;
    }

    if (["fakeml", "mlbbfake", "mlcard", "mlfake"].includes(command || "")) {
      await fakemlMode(m, sock, q, deviceId);
      return;
    }



    if (command === "iqc") {
      if (!q) {
        return reply(`💬 *ɪǫᴄ ᴍᴀᴋᴇʀ*\n\n> Masukkan teks\n\n\`Contoh: ${prefix}iqc halo apa kabar\``);
      }
      await react("🕕");
      try {
        const iqcUrl = `https://api.nexray.web.id/maker/iqc?text=${encodeURIComponent(q)}`;
        const res = await axios.get(iqcUrl, { responseType: "arraybuffer", timeout: 20000 });
        
        if (!res.data) throw new Error("Server API tidak mengirimkan data.");
        const buffer = Buffer.from(res.data);
        
        await send({ 
          image: buffer, 
          caption: `✅ *ɪǫᴄ ᴍᴀᴋᴇʀ ʙʏ CMNTY-BOT*` 
        });
        await react("✅");
      } catch (e: any) {
        console.error("[IQC Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal membuat gambar IQC: ${e.message}`);
      }
      return;
    }

    if (command === "fakektp") {
      if (!q || !q.includes("|")) {
          return reply(`🪪 *FAKE KTP INDONESIA*\n\n> Format: ${prefix}fakektp provinsi|kota|nik|nama|ttl|jeniskelamin|golongandarah|alamat|rtrw|keldesa|kecamatan|agama|status|pekerjaan|kewarganegaraan|masaberlaku|terbuat|pasphoto\n\n\`Contoh: ${prefix}fakektp JAWA BARAT|BANDUNG|1234567890123456|RESI OKTAVIA|Bandung, 01-01-1990|perempuan|O|Jl. Contoh No. 123|001/002|Mantan|Mantan terindah|Islam|Belum Kawin|Pegawai Swasta|WNI|Seumur Hidup|01-01-2023|https://i.pinimg.com/736x/0b/9f/0a/0b9f0a92a598e6c22629004c1027d23f.jpg\``);
      }
      const args = q.split("|");
      if (args.length < 18) {
          return reply("❌ Format salah. Pastikan semua 18 parameter diisi dipisahkan |");
      }
      const [provinsi, kota, nik, nama, ttl, jenis_kelamin, golongan_darah, alamat, rtrw, keldesa, kecamatan, agama, status, pekerjaan, kewarganegaraan, masa_berlaku, terbuat, pas_photo] = args;
      
      await react("🕕");
      try {
          const params = new URLSearchParams({
              provinsi, kota, nik, nama, ttl, jenis_kelamin, golongan_darah, alamat, 'rt/rw': rtrw, 'kel/desa': keldesa, kecamatan, agama, status, pekerjaan, kewarganegaraan, masa_berlaku, terbuat, pas_photo
          });
          const apiUrl = `https://api.siputzx.my.id/api/canvas/ektp?${params.toString()}`;
          const res = await axios.get(apiUrl, { responseType: "arraybuffer", timeout: 30000 });
          
          if (!res.data) throw new Error("API tidak merespon");
          const buffer = Buffer.from(res.data);
          
          await send({ image: buffer, caption: "🪪 *Fake KTP Generated*" });
          await react("✅");
      } catch (e: any) {
          await react("❌");
          reply(`❌ Gagal: ${e.message}`);
      }
      return;
    }

    if (["rvo", "readviewonce"].includes(command || "")) {
      await readViewOnce(m, sock, deviceId);
      return;
    }

    if (["toimg", "toimage", "stickertoimage", "stimg"].includes(command || "")) {
      await stickerToImage(m, sock, deviceId);
      return;
    }

    if (["remini"].includes(command || "")) {
      const typeMedia = Object.keys(m.message || {})[0];
      const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = !!m.message?.imageMessage;

      if (!isImage && !isQuotedImage) {
          return reply(`✨ *ʀᴇᴍɪɴɪ ᴇɴʜᴀɴᴄᴇ*\n\n> Kirim/reply gambar untuk di-enhance\n\n\`${prefix}remini\``);
      }

      await react("🕕");

      try {
          const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
          const stream = await downloadContentFromMessage(target, "image");
          let buffer = Buffer.alloc(0);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }

          if (!buffer) {
              await react("❌");
              return reply(`❌ Gagal mendownload gambar`);
          }

          const gmbr = await uploadToTmpFiles(buffer, {
              filename: 'image.jpg',
              contentType: 'image/jpeg'
          });

          const res = await fetch(`https://api.nexray.eu.cc/tools/remini?url=${encodeURIComponent(gmbr.directUrl)}`, { 
              signal: AbortSignal.timeout(120000),
              headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              }
          });
          
          if (!res.ok) throw new Error(`API returned status ${res.status}`);
          const arrayBuffer = await res.arrayBuffer();
          
          await react("✅");

          await sock.sendMessage(m.key.remoteJid!, {
              image: Buffer.from(arrayBuffer),
              caption: `✨ *Rᴇᴍɪɴɪ Dᴏɴᴇ*`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: m });

      } catch (error: any) {
          console.error("[Remini HD Error]:", error);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${error.message}`);
      }
      return;
    }

    if (["hdvid", "hdvideo", "enhancevid"].includes(command || "")) {
      const typeMedia = Object.keys(m.message || {})[0];
      const isQuotedVideo = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
      const isVideo = !!m.message?.videoMessage;

      if (!isVideo && !isQuotedVideo) {
          return reply(`✨ *ʜᴅ ᴠɪᴅᴇᴏ ᴇɴʜᴀɴᴄᴇ*\n\n> Kirim/reply video untuk di-enhance kualitasnya\n\n\`${prefix}hdvid\``);
      }

      await react("🕕");

      try {
          const target = isQuotedVideo ? m.message.extendedTextMessage.contextInfo.quotedMessage.videoMessage : m.message.videoMessage;
          const stream = await downloadContentFromMessage(target, "video");
          let buffer = Buffer.alloc(0);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }

          if (!buffer) {
              await react("❌");
              return reply(`❌ Gagal mendownload video`);
          }

          const vid = await uploadToTmpFiles(buffer, {
              filename: 'video.mp4',
              contentType: 'video/mp4'
          });

          const res = await fetch(`https://api.nexray.eu.cc/tools/hdvideo?url=${encodeURIComponent(vid.directUrl)}`, { 
              signal: AbortSignal.timeout(300000), 
              headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              }
          });
          
          if (!res.ok) throw new Error(`API returned status ${res.status}`);
          const json = await res.json();
          
          if (!json.status || !json.result) throw new Error(json.error || "Gagal memproses video");

          await react("✅");

          await sock.sendMessage(m.key.remoteJid!, {
              video: { url: json.result },
              caption: `✨ *HD Vɪᴅᴇᴏ Dᴏɴᴇ*`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: m });

      } catch (error: any) {
          console.error("[HD Video Error]:", error);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${error.message}`);
      }
      return;
    }

    if (["removebg", "nobg"].includes(command || "")) {
      const typeMedia = Object.keys(m.message || {})[0];
      const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = !!m.message?.imageMessage;

      if (!isImage && !isQuotedImage) {
          return reply(`🪄 *ʀᴇᴍᴏᴠᴇ ʙɢ*\n\n> Kirim/reply gambar untuk dihapus latar belakangnya\n\n\`${prefix}removebg\``);
      }

      await react("🕕");

      try {
          const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
          const stream = await downloadContentFromMessage(target, "image");
          let buffer = Buffer.alloc(0);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }

          if (!buffer) {
              await react("❌");
              return reply(`❌ Gagal mendownload gambar`);
          }

          const gmbr = await uploadToTmpFiles(buffer, {
              filename: 'image.jpg',
              contentType: 'image/jpeg'
          });

          const res = await fetch(`https://api.nexray.eu.cc/tools/removebg?url=${encodeURIComponent(gmbr.directUrl)}`, { 
              signal: AbortSignal.timeout(60000), 
              headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              }
          });
          
          if (!res.ok) throw new Error(`API returned status ${res.status}`);
          const imageBuffer = await res.arrayBuffer();
          
          if (!imageBuffer || imageBuffer.byteLength < 100) throw new Error("Gagal menghapus background atau hasil kosong");

          await react("✅");

          await sock.sendMessage(m.key.remoteJid!, {
              image: Buffer.from(imageBuffer),
              caption: `✨ *Rᴇᴍᴏᴠᴇ BG Dᴏɴᴇ*`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: m });

      } catch (error: any) {
          console.error("[RemoveBG Error]:", error);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${error.message}`);
      }
      return;
    }

    if (["blurface", "sensorwajah", "blur"].includes(command || "")) {
      const typeMedia = Object.keys(m.message || {})[0];
      const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
      const isImage = !!m.message?.imageMessage;

      if (!isImage && !isQuotedImage) {
          return reply(`👤 *ʙʟᴜʀ ꜰᴀᴄᴇ*\n\n> Kirim/reply gambar untuk menyensor wajah\n\n\`${prefix}blurface\``);
      }

      await react("🕕");

      try {
          const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
          const stream = await downloadContentFromMessage(target, "image");
          let buffer = Buffer.alloc(0);
          for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
          }

          if (!buffer) {
              await react("❌");
              return reply(`❌ Gagal mendownload gambar`);
          }

          const gmbr = await uploadToTmpFiles(buffer, {
              filename: 'face.jpg',
              contentType: 'image/jpeg'
          });

          const res = await fetch(`https://api.nexray.eu.cc/tools/blurface?url=${encodeURIComponent(gmbr.directUrl)}`, { 
              signal: AbortSignal.timeout(120000),
              headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              }
          });
          
          if (!res.ok) throw new Error(`API returned status ${res.status}`);
          const arrayBuffer = await res.arrayBuffer();
          
          await react("✅");

          await sock.sendMessage(m.key.remoteJid!, {
              image: Buffer.from(arrayBuffer),
              caption: `👤 *Bʟᴜʀ Fᴀᴄᴇ Dᴏɴᴇ*`,
              contextInfo: getContextInfo(deviceConfig, m)
          }, { quoted: m });

      } catch (error: any) {
          console.error("[Blur Face Error]:", error);
          await react("☢");
          reply(`❌ Terjadi kesalahan: ${error.message}`);
      }
      return;
    }

    if (command === "fakedana") {
      const nominal = q?.trim() || "10.000.000";
      await react("🕕");
      try {
        const danaUrl = `https://api.zenzxz.my.id/maker/fakedanav2?nominal=${encodeURIComponent(nominal)}`;
        await send({
          image: { url: danaUrl },
          caption: `✅ *ꜰᴀᴋᴇ ᴅᴀɴᴀ* \n> Nominal: Rp ${nominal}`
        });
        await react("✅");
      } catch (e: any) {
        console.error("[FakeDana Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal membuat fake dana: ${e.message}`);
      }
      return;
    }

    if (command === "cuaca") {
      if (!q || q.split('|').length !== 3) return reply(`🌤️ *Iɴғᴏ Cᴜᴀᴄᴀ*\n\n> Masukkan format yang benar: desa|kecamatan|provinsi\n\n\`Contoh: ${prefix}cuaca desa|kecamatan|provinsi\``);
      const [desa, kecamatan, provinsi] = q.split('|').map(v => v.trim());
      await react("🌤️");
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/information/cuaca?kota=${encodeURIComponent(`${desa}, ${kecamatan}, ${provinsi}`)}`);
        const data = res.data.result;
        if (!data || !data.forecasts || data.forecasts.length === 0) return reply("❌ Lokasi tidak ditemukan atau data cuaca sedang tidak tersedia.");

        let txt = `🌤️ *ᴘʀᴀᴋɪʀᴀᴀɴ ᴄᴜᴀᴄᴀ (ʙᴍᴋɢ)*\n\n`;
        txt += `┃ 📍 *Lokasi:* ${data.location.desa}, ${data.location.kecamatan}, ${data.location.provinsi}\n`;
        txt += `╰━━━━━━━━━━━━━━━━━━━━┈\n\n`;

        for (const f of data.forecasts) {
          txt += `*${f.waktu}*\n`;
          txt += `┃ ☁️ Kondisi: ${f.cuaca}\n`;
          txt += `┃ 🌡️ Suhu: ${f.suhu}\n`;
          txt += `┃ 💧 Lembab: ${f.kelembaban}\n`;
          txt += `┃ 🌬️ Angin: ${f.kecepatan_angin} (${f.arah_angin})\n`;
          txt += `┃ 👁️ Jarak Pandang: ${f.visibilitas}\n\n`;
        }
        txt += `> Data otomatis dari BMKG Indonesia`;

        await sock.sendMessage(m.key.remoteJid!, {
          image: { url: data.forecasts[0].image_url },
          caption: txt,
          contextInfo: getVerifiedQuoted(deviceConfig)
        }, { quoted: m });
        await react("✅");
      } catch (e: any) {
        console.error("[Cuaca Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mengambil data cuaca: ${e.message}`);
      }
      return;
    }

    if (command === "gempa" || command === "infogempa") {
      await react("🌋");
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/information/gempa`);
        const data = res.data.result;
        if (!data) return reply("❌ Gagal mendapatkan data gempa terbaru.");

        let txt = `🌋 *ɪɴꜰᴏ ɢᴇᴍᴘᴀ ᴛᴇʀᴋɪɴɪ (ʙᴍᴋɢ)*\n\n`;
        txt += `┃ 📅 *Tanggal:* ${data.Tanggal}\n`;
        txt += `┃ ⌚ *Waktu:* ${data.Jam}\n`;
        txt += `┃ 📉 *Magnitude:* ${data.Magnitude} SR\n`;
        txt += `┃ 🌊 *Kedalaman:* ${data.Kedalaman}\n`;
        txt += `┃ 📍 *Koordinat:* ${data.Coordinates}\n`;
        txt += `┃ 🗺️ *Wilayah:* ${data.Wilayah}\n`;
        txt += `┃ 🔔 *Potensi:* ${data.Potensi}\n`;
        txt += `┃ 👤 *Dirasakan:* ${data.Dirasakan}\n`;
        txt += `╰━━━━━━━━━━━━━━━━━━━━┈\n\n`;
        txt += `> Data otomatis dari BMKG Indonesia`;

        await sock.sendMessage(m.key.remoteJid!, {
          image: { url: data.Shakemap },
          caption: txt,
          contextInfo: getVerifiedQuoted(deviceConfig)
        }, { quoted: m });
        await react("✅");
      } catch (e: any) {
        console.error("[InfoGempa Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mengambil data gempa: ${e.message}`);
      }
      return;
    }

    if (command === "lirik" || command === "lyrics") {
      if (!q) return reply(`🎵 *Lʏʀɪᴄs Sᴇᴀʀᴄʜ*\n\n> Masukkan judul lagu\n\n\`Contoh: ${prefix}lirik surat cinta untuk starla\``);
      await react("🔍");
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/search/lyrics?q=${encodeURIComponent(q)}`);
        const data = res.data.result;
        if (!data || !data.lyrics) return reply("❌ Lirik tidak ditemukan.");

        const lyricsText = data.lyrics.plain_lyrics || data.lyrics.synced_lyrics.replace(/\[.*?\]\s/g, '');
        
        let caption = `🎵 *Lʏʀɪᴄs Fᴏᴜɴᴅ*\n\n`;
        caption += `*Title:* ${data.title}\n`;
        caption += `*Artist:* ${data.artist}\n`;
        caption += `*Album:* ${data.lyrics.album_name || '-'}\n\n`;
        caption += `--- Lʏʀɪᴄs ---\n\n${lyricsText}`;

        await sock.sendMessage(m.key.remoteJid!, {
            image: { url: data.thumbnail },
            caption: caption,
            contextInfo: getVerifiedQuoted(deviceConfig)
        }, { quoted: m });
        await react("✅");
      } catch (e: any) {
        console.error("[Lyrics Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mencari lirik: ${e.message}`);
      }
      return;
    }

    if (command === "nulis") {
      if (!q) return reply(`✍️ *Nᴜʟɪꜱ Bᴜᴋᴜ*\n\n> Masukkan teks yang ingin ditulis\n\n\`Contoh: ${prefix}nulis halo dunia\``);
      await react("🕕");
      try {
        const nulisUrl = `https://api.nexray.eu.cc/maker/nulis?text=${encodeURIComponent(q)}`;
        await sock.sendMessage(m.key.remoteJid!, {
            image: { url: nulisUrl },
            caption: `✍️ *Sᴜᴄᴄᴇss*`,
            contextInfo: getVerifiedQuoted(deviceConfig)
        }, { quoted: m });
        await react("✅");
      } catch (e: any) {
        console.error("[Nulis Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal membuat tulisan: ${e.message}`);
      }
      return;
    }



    if (["wastalk", "whatsappstalk", "stalkwa"].includes(command || "")) {
        let num = m.message?.extendedTextMessage?.contextInfo?.participant || m.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || q;
        
        if (!num) {
          return reply(`👤 *WʜᴀᴛsAᴘᴘ Sᴛᴀʟᴋᴇʀ*\n\n> Masukkan nomor WhatsApp atau tag orangnya\n\n\`Contoh: ${prefix}${command} 6281234567890 / tag\``);
        }

        await react("🕕");
        num = num.replace(/\D/g, "") + "@s.whatsapp.net";

        try {
          const onWa = await sock.onWhatsApp(num);
          if (!onWa || !onWa[0]?.exists) {
            await react("❌");
            return reply("❌ User tidak terdaftar di WhatsApp");
          }

          let img = "https://c.termai.cc/i160/3bfn6u.jpg";
          try {
            img = await sock.profilePictureUrl(num, "image");
          } catch (e) {}

          let bio: any = {};
          try {
            bio = await sock.fetchStatus(num);
          } catch (e) {}

          let name = "Unknown";
          try {
            // sock.getName might not exist in Baileys, using profile name if available
            name = m.pushName || "Unknown";
          } catch (e) {}

          let business: any = null;
          try {
            business = await sock.getBusinessProfile(num);
          } catch (e) {}

          let country = "Unknown";
          let formattedNumber = num.split("@")[0];
          try {
            const format = parsePhoneNumber("+" + num.split("@")[0]);
            if (format.valid) {
                country = regionNames.of(format.regionCode || "") || "Unknown";
                formattedNumber = format.number.international;
            }
          } catch (e) {
            console.error("[PhoneNumber Error]:", e);
          }

          let resText = `\t\t\t\t*▾ WHATSAPP ▾*\n\n` +
                    `*° Country :* ${country ? country.toUpperCase() : "-"}\n` +
                    `*° Format Number :* ${formattedNumber}\n` +
                    `*° Url Api :* wa.me/${num.split("@")[0]}\n` +
                    `*° Mentions :* @${num.split("@")[0]}\n` +
                    `*° Status :* ${bio?.status || "-"}\n` +
                    `*° Date Status :* ${bio?.setAt ? moment(bio.setAt).tz("Asia/Jakarta").format("LLLL") : "-"}\n\n`;

          if (business) {
            resText += `\t\t\t\t*▾ INFO BUSINESS ▾*\n\n` +
                     `*° BusinessId :* ${business.wid || "-"}\n` +
                     `*° Website :* ${business.website ? business.website : "-"}\n` +
                     `*° Email :* ${business.email ? business.email : "-"}\n` +
                     `*° Category :* ${business.category || "-"}\n` +
                     `*° Address :* ${business.address ? business.address : "-"}\n` +
                     `*° Timezone :* ${business.business_hours?.timezone ? business.business_hours.timezone : "-"}\n` +
                     `*° Description :* ${business.description ? business.description : "-"}`;
          } else {
            resText += "*Standard WhatsApp Account*";
          }

          await react("✅");
          await sock.sendMessage(m.key.remoteJid!, {
            image: { url: img },
            caption: resText,
            contextInfo: {
                ...getContextInfo(deviceConfig, m),
                mentionedJid: [num]
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });

        } catch (e: any) {
          console.error("[WaStalk Error]:", e.message);
          await react("❌");
          reply(`❌ Gagal mengecek data WhatsApp: ${e.message}`);
        }
        return;
      }

      if (["ttstalk", "tiktokstalk"].includes(command || "")) {
        if (!q) return reply(`👤 *ᴛɪᴋᴛᴏᴋ ꜱᴛᴀʟᴋᴇʀ*\n\n> Masukkan username TikTok\n\n\`Contoh: ${prefix}ttstalk cmnty.official\``);
        await react("🔍");
        try {
          const res = await axios.get(`https://api.cuki.biz.id/api/stalker/tktok?apikey=cuki-x&query=${encodeURIComponent(q)}`);
          const result = res.data;
          if (!result.status || !result.data) return reply("❌ User tidak ditemukan atau terjadi kesalahan.");

          const user = result.data;
          const stats = user.stats;

          let txt = `👤 *ᴛɪᴋᴛᴏᴋ ꜱᴛᴀʟᴋᴇʀ*\n\n`;
          txt += `┃ 🆔 *Username:* ${user.username}\n`;
          txt += `┃ ✨ *Nama:* ${user.name || "-"}\n`;
          txt += `┃ 📝 *Bio:* ${user.bio || "-"}\n`;
          txt += `┃ ✅ *Verified:* ${user.verified ? "Ya" : "Tidak"}\n`;
          txt += `┃ 🔒 *Private:* ${user.private_account ? "Ya" : "Tidak"}\n`;
          txt += `┃ 👥 *Following:* ${stats.following.toLocaleString()}\n`;
          txt += `┃ 👤 *Followers:* ${stats.followers.toLocaleString()}\n`;
          txt += `┃ ❤️ *Likes:* ${stats.likes.toLocaleString()}\n`;
          txt += `┃ 📹 *Videos:* ${stats.videos.toLocaleString()}\n`;
          txt += `┃ 🔗 *Link:* ${user.url}\n`;
          txt += `╰━━━━━━━━━━━━━━━━━━━━┈\n\n`;
          txt += `> Power by ${deviceConfig.bot?.name || "CMNTY-BOT"}`;

          await sock.sendMessage(m.key.remoteJid!, {
            image: { url: user.avatar_url },
            caption: txt,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          await react("✅");
        } catch (e: any) {
          console.error("[TTStalk Error]:", e.message);
          await react("❌");
          reply(`❌ Gagal stalking TikTok: ${e.message}`);
        }
        return;
      }

      if (["pinstalk", "pintereststalk"].includes(command || "")) {
        if (!q) return reply(`👤 *ᴘɪɴᴛᴇʀᴇꜱᴛ ꜱᴛᴀʟᴋᴇʀ*\n\n> Masukkan username Pinterest\n\n\`Contoh: ${prefix}pinstalk sesedayy\``);
        await react("🔍");
        try {
          const res = await axios.get(`https://api.cuki.biz.id/api/stalker/pinterest?apikey=cuki-x&query=${encodeURIComponent(q)}`);
          const result = res.data;
          if (!result.status || !result.data) return reply("❌ User tidak ditemukan atau terjadi kesalahan.");

          const user = result.data;
          
          let txt = `👤 *ᴘɪɴᴛᴇʀᴇꜱᴛ ꜱᴛᴀʟᴋᴇʀ*\n\n`;
          txt += `┃ 🆔 *Username:* ${user.username}\n`;
          txt += `┃ ✨ *Nama:* ${user.full_name || "-"}\n`;
          txt += `┃ 📝 *Bio:* ${user.biography || "-"}\n`;
          txt += `┃ 👥 *Followers:* ${user.follower_count || "-"}\n`;
          txt += `┃ 👤 *Following:* ${user.following_count || "-"}\n`;
          txt += `┃ 📸 *Media:* ${user.media_count || "-"}\n`;
          txt += `┃ 🔗 *Link:* ${user.url}\n`;
          txt += `╰━━━━━━━━━━━━━━━━━━━━┈\n\n`;
          txt += `> Power by ${deviceConfig.bot?.name || "CMNTY-BOT"}`;

          await sock.sendMessage(m.key.remoteJid!, {
            image: { url: user.profile_pic_url },
            caption: txt,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          await react("✅");
        } catch (e: any) {
          console.error("[PinStalk Error]:", e.message);
          await react("❌");
          reply(`❌ Gagal stalking Pinterest: ${e.message}`);
        }
        return;
      }

      if (["gitstalk", "githubstalk"].includes(command || "")) {
        if (!q) return reply(`👤 *ɢɪᴛʜᴜʙ ꜱᴛᴀʟᴋᴇʀ*\n\n> Masukkan username GitHub\n\n\`Contoh: ${prefix}gitstalk Creatorsitee\``);
        await react("🔍");
        try {
          const res = await axios.get(`https://api.cuki.biz.id/api/stalker/github?apikey=cuki-x&query=${encodeURIComponent(q)}`);
          const result = res.data;
          if (!result.status || !result.data) return reply("❌ User tidak ditemukan atau terjadi kesalahan.");

          const user = result.data;
          
          let txt = `👤 *ɢɪᴛʜᴜʙ ꜱᴛᴀʟᴋᴇʀ*\n\n`;
          txt += `┃ 🆔 *Username:* ${user.login}\n`;
          txt += `┃ ✨ *Nama:* ${user.name || "-"}\n`;
          txt += `┃ 📝 *Bio:* ${user.bio || "-"}\n`;
          txt += `┃ 🏢 *Perusahaan:* ${user.company || "-"}\n`;
          txt += `┃ 📍 *Lokasi:* ${user.location || "-"}\n`;
          txt += `┃ 🌐 *Blog:* ${user.blog || "-"}\n`;
          txt += `┃ 📂 *Public Repos:* ${user.public_repos}\n`;
          txt += `┃ 👤 *Followers:* ${user.followers}\n`;
          txt += `┃ 👥 *Following:* ${user.following}\n`;
          txt += `┃ 📅 *Dibuat:* ${new Date(user.created_at).toLocaleDateString("id-ID")}\n`;
          txt += `┃ 🔗 *Link:* ${user.html_url}\n`;
          txt += `╰━━━━━━━━━━━━━━━━━━━━┈\n\n`;
          txt += `> Power by ${deviceConfig.bot?.name || "CMNTY-BOT"}`;

          await sock.sendMessage(m.key.remoteJid!, {
            image: { url: user.avatar_url },
            caption: txt,
            contextInfo: {
              ...getContextInfo(deviceConfig, m),
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: deviceConfig.bot?.name || "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          }, { quoted: getVerifiedQuoted(deviceConfig) as any });
          await react("✅");
        } catch (e: any) {
          console.error("[GitStalk Error]:", e.message);
          await react("❌");
          reply(`❌ Gagal stalking GitHub: ${e.message}`);
        }
        return;
      }

      if (["igstalk", "instagramstalk", "stalking"].includes(command || "")) {
        const username = args[0]?.replace('@', '');
        
        if (!username) {
            return reply(
                `📸 *ɪɴsᴛᴀɢʀᴀᴍ sᴛᴀʟᴋ*\n\n` +
                `> Masukkan username Instagram\n\n` +
                `\`Contoh: ${prefix}${command} cristiano\``
            );
        }
        
        await react("🔍");
        
        try {
            const res = await axios.post(
                'https://api.boostfluence.com/api/instagram-profile-v2',
                { username },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0'
                    },
                    timeout: 30000
                }
            );
            
            const d = res.data;
            if (!d?.username) {
                await react("❌");
                return reply(`❌ Akun *@${username}* tidak ditemukan`);
            }
            
            const shortNum = (num: any) => {
                if (!num) return '0';
                if (num >= 1_000_000_000)
                    return (num / 1_000_000_000).toFixed(1).replace('.0', '') + ' miliar';
                if (num >= 1_000_000)
                    return (num / 1_000_000).toFixed(1).replace('.0', '') + ' jt';
                if (num >= 1_000)
                    return (num / 1_000).toFixed(1).replace('.0', '') + ' rb';
                return num.toString();
            };

            const caption = `📸 *ɪɴsᴛᴀɢʀᴀᴍ sᴛᴀʟᴋ*\n\n` +
                `👤 *Username:* ${d.username}\n` +
                `📛 *Nama:* ${d.full_name || '-'}\n` +
                `✅ *Verified:* ${d.is_verified ? 'Ya' : 'Tidak'}\n` +
                `🔒 *Private:* ${d.is_private ? 'Ya' : 'Tidak'}\n\n` +
                `👥 *Pengikut:* ${shortNum(d.follower_count)}\n` +
                `👤 *Mengikuti:* ${shortNum(d.following_count)}\n` +
                `📷 *Postingan:* ${shortNum(d.media_count)}\n\n` +
                `📝 *Bio:*\n${d.biography || '-'}\n\n` +
                `🔗 https://instagram.com/${d.username}`;
            
            await react("✅");
            
            const profilePic = d.profile_pic_url_hd || d.profile_pic_url;
            const vQuoted = getVerifiedQuoted(deviceConfig);
            if (profilePic) {
                await sock.sendMessage(chatId, {
                    image: { url: profilePic },
                    caption,
                    contextInfo: getContextInfo(deviceConfig, m)
                }, { quoted: vQuoted as any });
            } else {
                await sock.sendMessage(chatId, {
                    text: caption,
                    contextInfo: getContextInfo(deviceConfig, m, null, true, true)
                }, { quoted: vQuoted as any });
            }
            
        } catch (error: any) {
            console.error("[IGStalk Error]:", error.message);
            await react("☢️");
            reply(`❌ Terjadi kesalahan: ${error.message}`);
        }
        return;
      }

    if (["stalkml", "mlstalk"].includes(command || "")) {
      if (!q || !q.includes("|")) {
        return reply(`🎮 *Sᴛᴀʟᴋ MLBB*\n\n> Cek informasi akun Mobile Legends dengan memasukkan ID dan Zone/Server ID\n\n\`Contoh: ${prefix}${command} 1234567|1234\``);
      }
      
      const [id, zone] = q.split("|").map(s => s.trim());
      if (!id || !zone) {
        return reply(`🎮 *Sᴛᴀʟᴋ MLBB*\n\n> Cek informasi akun Mobile Legends dengan memasukkan ID dan Zone/Server ID\n\n\`Contoh: ${prefix}${command} 1234567|1234\``);
      }
      await react("🕕");
      
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/stalker/mlbb?id=${encodeURIComponent(id)}&zone=${encodeURIComponent(zone)}`);
        
        if (res.data && res.data.status) {
           const data = res.data.result;
           let msgResult = `🎮 *Mᴏʙɪʟᴇ Lᴇɢᴇɴᴅꜱ Sᴛᴀʟᴋᴇʀ*\n\n`;
           msgResult += `> 👤 *Nɪᴄᴋɴᴀᴍᴇ:* ${data.username}\n`;
           msgResult += `> 🆔 *ID:* ${data.id}\n`;
           msgResult += `> 🌐 *Zᴏɴᴇ:* ${data.zone}\n`;
           msgResult += `> 🌍 *Rᴇɢɪᴏɴ:* ${data.region}\n`;
           
           await reply(msgResult);
           await react("✅");
        } else {
           await react("❌");
           reply(`❌ *Gagal:* ${res.data?.error || "Gagal mendapatkan data akun. Cek ID dan Server kamu."}`);
        }
      } catch (e: any) {
        console.error("[StalkML Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mengecek data akun: ${e.message}`);
      }
      return;
    }

    if (["roblox", "stalkrbx", "stalkroblox"].includes(command || "")) {
      const username = q?.trim();
      if (!username) {
        return reply(`🎮 *Sᴛᴀʟᴋ Rᴏʙʟᴏx*\n\n> Masukkan username Roblox untuk mengecek detail akun pemain\n\n\`Contoh: ${prefix}roblox builderman\``);
      }
      
      await react("🕕");
      
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/stalker/roblox?username=${encodeURIComponent(username)}`);
        
        if (res.data && res.data.status) {
           const data = res.data.result;
           const basic = data.basic || {};
           const social = data.social || {};
           const groups = data.groups?.list?.data || [];
           const avatar = data.avatar?.fullBody?.data?.[0]?.imageUrl || data.avatar?.headshot?.data?.[0]?.imageUrl;
           
           let msgResult = `🎮 *Rᴏʙʟᴏx Sᴛᴀʟᴋᴇʀ*\n\n`;
           msgResult += `> 👤 *Uꜱᴇʀɴᴀᴍᴇ:* ${basic.name || username}\n`;
           if (basic.displayName && basic.displayName !== basic.name) {
             msgResult += `> 🏷️ *Dɪꜱᴘʟᴀʏ Nᴀᴍᴇ:* ${basic.displayName}\n`;
           }
           msgResult += `> 🆔 *Uꜱᴇʀ ID:* ${data.userId || basic.id || '-'}\n`;
           msgResult += `> 📅 *Cʀᴇᴀᴛᴇᴅ:* ${basic.created ? new Date(basic.created).toLocaleDateString("id-ID") : '-'}\n`;
           msgResult += `> 🚫 *Bᴀɴɴᴇᴅ:* ${basic.isBanned ? 'Ya' : 'Tidak'}\n`;
           msgResult += `> 🏅 *Vᴇʀɪꜰɪᴇᴅ:* ${basic.hasVerifiedBadge ? 'Ya' : 'Tidak'}\n\n`;
           
           msgResult += `👥 *Sᴏᴄɪᴀʟ*\n`;
           msgResult += `> *Fʀɪᴇɴᴅꜱ:* ${social.friends?.count || 0}\n`;
           msgResult += `> *Fᴏʟʟᴏᴡᴇʀꜱ:* ${social.followers?.count || 0}\n`;
           msgResult += `> *Fᴏʟʟᴏᴡɪɴɢ:* ${social.following?.count || 0}\n\n`;

           if (groups.length > 0) {
             msgResult += `🎖️ *Gʀᴏᴜᴘꜱ (Tᴏᴘ 3)*\n`;
             groups.slice(0, 3).forEach((g: any) => {
               msgResult += `> - ${g.group?.name || 'Unknown'} (${g.role?.name || 'Member'})\n`;
             });
           }
           
           if (avatar) {
             await send({
               image: { url: avatar },
               caption: msgResult
             });
           } else {
             await reply(msgResult);
           }
           await react("✅");
        } else {
           await react("❌");
           reply(`❌ *Gagal:* ${res.data?.error || "User tidak ditemukan."}`);
        }
      } catch (e: any) {
        console.error("[StalkRoblox Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mengecek data akun Roblox: ${e.message}`);
      }
      return;
    }
    if (["stalkff", "ffstalk"].includes(command || "")) {
      const uid = q?.trim();
      if (!uid) {
        return reply(`🎮 *Sᴛᴀʟᴋ Free Fire*\n\n> Masukkan UID akun Free Fire untuk mengecek detail akun pemain\n\n\`Contoh: ${prefix}${command} 1694332345\``);
      }
      
      await react("🕕");
      
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/stalker/freefire?uid=${encodeURIComponent(uid)}`);
        
        if (res.data && res.data.status) {
           const data = res.data.result;
           let msgResult = `🎮 *Fʀᴇᴇ Fɪʀᴇ Sᴛᴀʟᴋᴇʀ*\n\n`;
           msgResult += `> 👤 *Nɪᴄᴋɴᴀᴍᴇ:* ${data.name || '-'}\n`;
           msgResult += `> 🆔 *UID:* ${data.uid || '-'}\n`;
           
           msgResult += `> 🌍 *Rᴇɢɪᴏɴ:* ${data.region || '-'}\n`;
           msgResult += `> 📅 *Cʀᴇᴀᴛᴇᴅ:* ${data.created_at || '-'}\n`;
           msgResult += `> 🕒 *Lᴀꜱᴛ Lᴏɢɪɴ:* ${data.last_login || '-'}\n`;
           
           await reply(msgResult);
           await react("✅");
        } else {
           await react("❌");
           reply(`❌ *Gagal:* ${res.data?.error || "Gagal mendapatkan data akun Free Fire. Periksa UID."}`);
        }
      } catch (e: any) {
        console.error("[StalkFF Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mengecek data akun: ${e.message}`);
      }
      return;
    }


    if (["genshin", "stalkgenshin", "gi"].includes(command || "")) {
      const id = q?.trim();
      if (!id) {
        return reply(`🎮 *Sᴛᴀʟᴋ Gᴇɴꜱʜɪɴ*\n\n> Masukkan UID akun Genshin Impact Anda\n\n\`Contoh: ${prefix}genshin 856012067\``);
      }
      
      await react("🕕");
      
      try {
        const res = await axios.get(`https://api.nexray.eu.cc/stalker/genshin?id=${encodeURIComponent(id)}`);
        
        if (res.data && res.data.status) {
           const data = res.data.result;
           const player = data.player_info;
           let msgResult = `🎮 *Gᴇɴꜱʜɪɴ Iᴍᴘᴀᴄᴛ Sᴛᴀʟᴋᴇʀ*\n\n`;
           msgResult += `> 👤 *Nɪᴄᴋɴᴀᴍᴇ:* ${player.nickname || '-'}\n`;
           msgResult += `> 🆔 *UID:* ${data.id || '-'}\n`;
           
           
           msgResult += `> 🏆 *Aᴄʜɪᴇᴠᴇᴍᴇɴᴛꜱ:* ${player.achievements || '-'}\n`;
           msgResult += `> 🌀 *Sᴘɪʀᴀʟ Aʙʏꜱꜱ:* ${player.spiral_abyss || '-'}\n`;
           msgResult += `> 🎭 *Iᴍᴀɢɪɴᴀʀɪᴜᴍ Tʜᴇᴀᴛᴇʀ:* ${player.theater || '-'}\n`;
           msgResult += `> ✍️ *Sɪɢɴᴀᴛᴜʀᴇ:* ${player.signature || '-'}\n`;
           
           if (data.image_url) {
             await sock.sendMessage(m.key.remoteJid!, { image: { url: data.image_url }, caption: msgResult, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: m });
           } else {
             await reply(msgResult);
           }
           await react("✅");
        } else {
           await react("❌");
           reply(`❌ *Gagal:* ${res.data?.error || "Gagal mendapatkan data akun Genshin. Periksa UID."}`);
        }
      } catch (e: any) {
        console.error("[StalkGenshin Error]:", e.message);
        await react("❌");
        reply(`❌ Gagal mengecek data akun: ${e.message}`);
      }
      return;
    }

    if (["fakecall", "fakecallwa"].includes(command || "")) {
      if (!q || !q.includes("|")) {
      return reply(`📞 *Fᴀᴋᴇ Cᴀʟʟ*\n\n> Masukkan nama penelepon dan durasi panggilan (dipisahkan dengan |)\n\n\`Contoh: ${prefix}${command} Sayangku | 05:20\`\n\n💡 *Tips:* Balas gambar seseorang untuk mengkustomisasi avatar.`);
      }
      
      const [nama, durasi] = q.split("|").map(s => s.trim());
      if (!nama) return reply(`❌ Nama tidak boleh kosong!`);

      await react("🕕");
      
      try {
        let avatar = "https://c.termai.cc/i160/3bfn6u.jpg";
        
        // Handle media download for avatar
        const typeMedia = Object.keys(m.message || {})[0];
        const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const isImage = !!m.message?.imageMessage;
        
        if (isImage || isQuotedImage) {
           const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
           const stream = await downloadContentFromMessage(target, "image");
           let buffer = Buffer.from([]);
           for await (const chunk of stream) {
             buffer = Buffer.concat([buffer, chunk]);
           }
           
           // Upload to tmpfiles for the API to access
           const form = new FormData();
           form.append("file", buffer, { filename: "avatar.jpg", contentType: "image/jpeg" });
           const uploadRes = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
             headers: form.getHeaders(),
             timeout: 30000
           });
           
           if (uploadRes.data?.status === "success" && uploadRes.data?.data?.url) {
             avatar = uploadRes.data.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
           }
        } else {
           try {
             avatar = await sock.profilePictureUrl(m.sender, "image");
           } catch {
             avatar = "https://c.termai.cc/i160/3bfn6u.jpg";
           }
        }

        const apiUrl = `https://api.cuki.biz.id/api/canvas/fakecall?apikey=cuki-x&nama=${encodeURIComponent(nama)}&durasi=${encodeURIComponent(durasi)}&avatar=${encodeURIComponent(avatar)}`;
        const res = await axios.get(apiUrl, { responseType: "arraybuffer", timeout: 20000 });
        
        await send({ 
           image: Buffer.from(res.data), 
           caption: `📞 *ꜰᴀᴋᴇ ᴄᴀʟʟ ᴡᴀ ꜱᴜᴄᴄᴇꜱꜱ*`
        });
        
        await react("📞");
      } catch (e: any) {
        console.error(e);
        await react("☢");
        return reply(`❌ Gagal membuat fakecall: ${e.message}`);
      }
      return;
    }

    if (["tourl", "upload", "catbox", "url"].includes(command || "")) {
        let media: Buffer | null = null;
        let mimetype: string | null = null;
        let filename = 'file';

        const typeMedia = Object.keys(m.message || {})[0];
        const quotedMsg = m.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        let targetMsg: any = null;
        let targetType: string | null = null;

        if (quotedMsg) {
            targetType = Object.keys(quotedMsg)[0];
            if (targetType !== 'conversation' && targetType !== 'extendedTextMessage') {
                targetMsg = quotedMsg[targetType];
            }
        } else if (typeMedia !== 'conversation' && typeMedia !== 'extendedTextMessage') {
             targetType = typeMedia;
             targetMsg = m.message[typeMedia];
        }

        if (!targetMsg || !targetType) {
             return reply('⚠️ Reply media (gambar/video/audio/file) atau kirim media dengan caption `.tourl`');
        }

        try {
             let mediaType = targetType.replace('Message', '');
             if (mediaType === 'documentWithCaption') mediaType = 'document';
             
             const stream = await downloadContentFromMessage(targetMsg, mediaType as any);
             let buffer = Buffer.alloc(0);
             for await (const chunk of stream) {
                 buffer = Buffer.concat([buffer, chunk]);
             }
             media = buffer;
             mimetype = targetMsg.mimetype || 'application/octet-stream';
             
             const mimeMap: Record<string, string> = {
                  'image/jpeg': 'jpg',
                  'image/png': 'png',
                  'image/gif': 'gif',
                  'image/webp': 'webp',
                  'video/mp4': 'mp4',
                  'video/3gpp': '3gp',
                  'video/quicktime': 'mov',
                  'audio/mpeg': 'mp3',
                  'audio/ogg': 'ogg',
                  'audio/wav': 'wav',
                  'audio/mp4': 'm4a',
                  'application/pdf': 'pdf',
                  'application/zip': 'zip'
             };
             const ext = mimeMap[mimetype] || 'bin';
             filename = targetMsg.fileName || `file.${ext}`;

        } catch (e: any) {
             console.error("[ToUrl Error]:", e.message);
             return reply(`❌ Gagal mendownload media: ${e.message}`);
        }

        if (!media || media.length === 0) {
            return reply('⚠️ Media tidak ditemukan!');
        }

        await react("🕕");

        const results: any[] = [];
        const failed: string[] = [];

        for (const uploader of UPLOADERS) {
            try {
                const result = await uploader.fn(media, filename);
                results.push(result);
            } catch (e: any) {
                console.error(`[ToUrl ${uploader.name} Error]:`, e.message);
                failed.push(uploader.name);
            }
        }

        if (results.length === 0) {
            await react("❌");
            return reply(`❌ Semua upload gagal!\n\n> Failed: ${failed.join(', ')}`);
        }

        let caption = `╭┈┈⬡「 📋 *ʀᴇsᴜʟᴛ* 」\n`;
        results.forEach((r) => {
            caption += `┃ ${r.url}\n`;
        });
        caption += `╰┈┈┈┈┈┈┈┈⬡\n\n`;    
        
        if (failed.length > 0) {
            caption += `> ❌ Gagal: ${failed.join(', ')}`;
        }

        await reply(caption);
        await react("✅");
        return;
    }

      if (["deploy", "vercel"].includes(command || "")) {
        if (!isOwner) return reply("❌ Fitur ini hanya untuk Owner bot.");
        const name = args[0]?.trim();
        
        if (!name) {
            return reply(
                `🚀 *DEPLOY SYSTEM*\n\n` +
                `> Masukkan nama project tanpa spasi.\n` +
                `> Reply: Kode HTML, File .html, atau File .zip\n\n` +
                `Contoh: *${prefix}deploy mysite*`
            );
        }

        const quoted = msg.extendedTextMessage?.contextInfo?.quotedMessage;
        if (!quoted) {
            return reply('❌ *KONTEN TIDAK DITEMUKAN*\n\nSilahkan reply file ZIP, File HTML, atau Teks Kode HTML yang ingin di-deploy.');
        }

        const token = deviceConfig.vercelToken || deviceConfig.vercel?.token;
        if (!token) return reply('❌ *Vercel token belum diset di config!*');

        await react("🚀");

        let filesToDeploy: any[] = [];
        const qMime = (quoted.documentMessage || quoted.imageMessage || quoted.videoMessage || quoted.audioMessage)?.mimetype || '';
        const qFileName = (quoted.documentMessage?.fileName || '').toLowerCase();

        try {
            if (qMime === 'application/zip' || qFileName.endsWith('.zip')) {
                const stream = await downloadContentFromMessage(quoted.documentMessage as any, 'document');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                
                const zip = new AdmZip(buffer);
                const zipEntries = zip.getEntries();

                zipEntries.forEach((entry: any) => {
                    if (!entry.isDirectory && !entry.entryName.startsWith('__MACOSX')) {
                        filesToDeploy.push({
                            file: entry.entryName,
                            data: entry.getData().toString('utf-8')
                        });
                    }
                });

                if (filesToDeploy.length === 0) throw new Error("File ZIP kosong atau tidak valid!");
            } else {
                let content = '';
                if (quoted.conversation || quoted.extendedTextMessage?.text) {
                    content = quoted.conversation || quoted.extendedTextMessage?.text || '';
                } else if (qMime === 'text/html' || qFileName.endsWith('.html')) {
                    const stream = await downloadContentFromMessage(quoted.documentMessage as any, 'document');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }
                    content = buffer.toString();
                } else {
                    throw new Error("Format tidak didukung! Gunakan ZIP, HTML, atau Teks Kode.");
                }

                filesToDeploy.push({
                    file: 'index.html',
                    data: content
                });
            }

            const payload = {
                name: name,
                project: name,
                target: 'production',
                files: filesToDeploy,
                projectSettings: {
                    framework: null
                }
            };

            await axios.post(
                'https://api.vercel.com/v13/deployments',
                payload,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 60000
                }
            );

            await react("✅");
            const fixedURL = `https://${name.toLowerCase().replace(/\s+/g, '-')}.vercel.app`;

            await reply(
                `╭──「 *DEPLOY SUCCESS* 」\n` +
                `│\n` +
                `│ 🌐 Project  : ${name}\n` +
                `│ 📦 Content  : ${filesToDeploy.length > 1 ? 'Full Website (ZIP)' : 'Single HTML'}\n` +
                `│ ⚙️ Status   : Production / Active\n` +
                `│\n` +
                `│ 🔗 URL:\n` +
                `│ ${fixedURL}\n` +
                `│\n` +
                `╰────────────────`
            );

        } catch (error: any) {
            await react("❌");
            console.error("Vercel Deploy Error:", error);
            const errMessage = error.response?.data?.error?.message || error.message;
            reply(
                `╭──「 *DEPLOY FAILED* 」\n` +
                `│\n` +
                `│ ❌ Error: ${errMessage}\n` +
                `│ 💡 Tips: Pastikan nama project unik dan token benar.\n` +
                `│\n` +
                `╰────────────────`
            );
        }
        return;
      }

      if (["join", "joingrup", "joingroup", "gabung"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa menggunakan fitur join!');
        
        const input = args.join(' ').trim();
        if (!input) {
            return reply(
                `🔗 *ᴊᴏɪɴ ɢʀᴜᴘ*\n\n` +
                `╭┈┈⬡「 📋 *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ* 」\n` +
                `┃ ◦ Kirim link invite grup\n` +
                `┃ ◦ Bot akan otomatis join\n` +
                `╰┈┈⬡\n\n` +
                `\`Contoh: ${prefix}join https://chat.whatsapp.com/xxx\``
            );
        }

        const extractInviteCode = (text: string) => {
            const patterns = [
                /chat\.whatsapp\.com\/([a-zA-Z0-9]{20,})/i,
                /wa\.me\/([a-zA-Z0-9]{20,})/i,
                /^([a-zA-Z0-9]{20,})$/
            ];
            for (const pattern of patterns) {
                const match = text?.match(pattern);
                if (match) return match[1];
            }
            return null;
        };

        const inviteCode = extractInviteCode(input);
        
        if (!inviteCode) {
            return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Link invite tidak valid`);
        }
        
        await react('🕕');
        
        try {
            const groupInfo = await sock.groupGetInviteInfo(inviteCode).catch(() => null);
            
            if (!groupInfo) {
                await react('❌');
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Tidak dapat mengambil info grup`);
            }
            
            const botJid = sock.user?.id?.replace(/:.*@/, '@') || '';
            const isMember = groupInfo.participants?.some(p => 
                p.id === botJid || p.id?.includes(sock.user?.id?.split(':')[0] || '')
            );
            
            if (isMember) {
                await react('❌');
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Bot sudah menjadi member di grup ini`);
            }
            
            await sock.groupAcceptInvite(inviteCode);
            await react('✅');
            
            const saluranId = deviceConfig.saluran?.id || '120363426467190619@newsletter';
            const saluranName = deviceConfig.saluran?.name || deviceConfig.bot?.name || 'CMNTY-BOT';
            
            await sock.sendMessage(chatId, {
                text: `✅ *ʙᴇʀʜᴀsɪʟ ᴊᴏɪɴ*\n\n` +
                    `╭┈┈⬡「 📋 *ɪɴꜰᴏ ɢʀᴜᴘ* 」\n` +
                    `┃ 🏠 ɴᴀᴍᴀ: *${groupInfo.subject || 'Unknown'}*\n` +
                    `┃ 👥 ᴍᴇᴍʙᴇʀ: *${groupInfo.size || groupInfo.participants?.length || 0}*\n` +
                    `┃ 👤 ᴏᴡɴᴇʀ: *${groupInfo.owner?.split('@')[0] || 'Unknown'}*\n` +
                    `╰┈┈⬡`,
                contextInfo: {
                    forwardingScore: 9999,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: saluranId,
                        newsletterName: saluranName,
                        serverMessageId: 127
                    }
                }
            }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
        } catch (error: any) {
            await react('❌');
            
            let errorMsg = error.message;
            if (errorMsg.includes('not-authorized')) {
                errorMsg = 'Link sudah tidak valid atau expired';
            } else if (errorMsg.includes('gone')) {
                errorMsg = 'Grup sudah tidak ada';
            } else if (errorMsg.includes('conflict')) {
                errorMsg = 'Bot sudah menjadi member';
            }
            
            await reply(`❌ *ɢᴀɢᴀʟ*\n\n> ${errorMsg}`);
        }
        return;
      }

      if (["buatgrup", "creategroup", "newgroup"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa membuat grup baru!');
        
        const textStr = args.join(" ").trim() || "";
        const pipeIdx = textStr.indexOf('|');

        if (pipeIdx === -1) {
            return reply(
                '👥 *ʙᴜᴀᴛ ɢʀᴜᴘ ʙᴀʀᴜ*\n\n' +
                '> `.buatgrup Nama Grup|628xxx,628yyy`\n\n' +
                '• Gunakan `|` untuk memisahkan nama dan peserta\n' +
                '• Pisahkan nomor peserta dengan koma\n' +
                '• Bot otomatis menjadi admin\n\n' +
                '📝 Contoh:\n' +
                '> `.buatgrup Tim Alpha|628123,628456`'
            );
        }

        const name = textStr.substring(0, pipeIdx).trim();
        const participantsStr = textStr.substring(pipeIdx + 1).trim();

        if (!name || name.length < 2) {
            return reply('❌ Nama grup minimal 2 karakter.');
        }

        const participants = participantsStr
            .split(/[,;\\s]+/)
            .map(n => n.replace(/[^0-9]/g, ''))
            .filter(n => n.length >= 5)
            .map(n => n + '@s.whatsapp.net');

        if (participants.length === 0) {
            return reply('❌ Masukkan minimal 1 nomor peserta.');
        }

        try {
            const group = await sock.groupCreate(name, participants);
            await react('✅');
            return reply(
                `👥 *ɢʀᴜᴘ ᴅɪʙᴜᴀᴛ*\n\n` +
                `> Nama: ${name}\n` +
                `> ID: ${group.id}\n` +
                `> Peserta: ${participants.length} orang\n\n` +
                `_Bot otomatis menjadi admin_`
            );
        } catch (err: any) {
            return reply(`❌ Gagal membuat grup: ${err.message}`);
        }
      }

      if (["buatsaluran", "createsaluran", "createnewsletter"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa membuat saluran baru!');
        
        const textStr = args.join(" ").trim() || "";
        const pipeIdx = textStr.indexOf('|');

        let name, description;
        if (pipeIdx === -1) {
            name = textStr;
            description = "";
        } else {
            name = textStr.substring(0, pipeIdx).trim();
            description = textStr.substring(pipeIdx + 1).trim();
        }

        if (!name || name.length < 2) {
            return reply(
            "📢 *ʙᴜᴀᴛ sᴀʟᴜʀᴀɴ*\n\n" +
                "> `.buatsaluran Nama Saluran`\n" +
                "> `.buatsaluran Nama|Deskripsi`\n\n" +
                "📝 Contoh:\n" +
                "> `.buatsaluran Info Bot`\n" +
                "> `.buatsaluran Info Bot|Update terbaru bot kami`"
            );
        }

        try {
            const result = await sock.newsletterCreate(name, description || undefined);
            const saluranId = result?.id || result?.thread_metadata?.id || "unknown";
            const saluranName = result?.name || name;
            await react("✅");
            return reply(
            `📢 *sᴀʟᴜʀᴀɴ ᴅɪʙᴜᴀᴛ*\n\n` +
                `> Nama: ${saluranName}\n` +
                (description ? `> Deskripsi: ${description}\n` : "") +
                `> ID: ${saluranId}\n` +
                `> Subscribers: ${result?.subscribers || 0}\n\n` +
                `_Saluran ini bisa dikonfigurasi di config.saluran.id_`
            );
        } catch (err: any) {
            return reply(`❌ Gagal membuat saluran: ${err.message}`);
        }
      }

      if (["upch", "uploadch", "uploadsaluran", "uch"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa menggunakan fitur ini!');
        
        const chId = args[0]?.includes("@newsletter") ? args.shift() : (config.channel?.id || "");
        const caption = args.join(" ").trim();
        
        const quoted = m.quoted || m;
        const isImage = m.isImage || (m.quoted && m.quoted.type === 'imageMessage');
        const isVideo = m.isVideo || (m.quoted && m.quoted.type === 'videoMessage');
        const isAudio = m.type === 'audioMessage' || (m.quoted && m.quoted.type === 'audioMessage');
        const isMedia = isImage || isVideo || isAudio;

        if (!isMedia && !caption) {
            return reply(
                `📤 *UPLOAD SALURAN*\n\n` +
                `Kirim/reply media dengan caption:\n` +
                `  \`${prefix}upch 12xxx@newsletter <teks opsional>\`\n\n` +
                `*Support:*\n` +
                `  🖼️ Gambar\n` +
                `  🎥 Video\n` +
                `  🎵 Audio/VN\n` +
                `  📝 Teks (tanpa media)`
            );
        }

        if (!chId) return reply("❌ ID saluran belum dikonfigurasi!");

        await react("🕕");

        const saluranId = config.channel?.id || '120363426467190619@newsletter';
        const saluranName = config.channel?.name || config.bot?.name || 'CMNTY-BOT';

        try {
            if (!isMedia && caption) {
                await sock.sendMessage(chId, { 
                    text: caption,
                    contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 1
                        }
                    }
                });
                await react("✅");
                return reply(`✅ Teks berhasil dikirim ke saluran`);
            }

            const mediaBuf = await downloadMediaMessage(quoted, "buffer", {});
            
            if (isImage) {
                await sock.sendMessage(chId, {
                    image: mediaBuf,
                    caption: caption || undefined,
                    contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 1
                        }
                    }
                });
                await react("✅");
            } else if (isVideo) {
                await sock.sendMessage(chId, {
                    video: mediaBuf,
                    caption: caption || undefined,
                    contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 1
                        }
                    }
                });
                await react("✅");
            } else if (isAudio) {
                const tmp = path.join(os.tmpdir(), crypto.randomBytes(6).toString("hex"));
                fs.writeFileSync(tmp, mediaBuf);
                const out = tmp + ".ogg";
                
                await execPromise(`ffmpeg -y -i "${tmp}" -vn -map_metadata -1 -ac 1 -ar 48000 -c:a libopus -b:a 96k -vbr on -application audio -f ogg "${out}"`);
                const opusBuf = fs.readFileSync(out);
                
                await sock.sendMessage(chId, {
                    audio: opusBuf,
                    mimetype: "audio/ogg; codecs=opus",
                    ptt: true,
                     contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 1
                        }
                    }
                });
                await react("✅");
                
                fs.unlinkSync(tmp);
                fs.unlinkSync(out);
            } else {
                await react("❌");
                return reply("❌ Tipe media tidak didukung");
            }
        } catch (e: any) {
            console.error("[UpCh]", e);
            await react("☢");
            return reply(`❌ Terjadi kesalahan: ${e.message}`);
        }
        return;
      }

      if (["pay", "payment"].includes(command || "")) {
        if (!isOwner) return reply('🚫 *ᴀᴋsᴇs ᴅɪᴛᴏʟᴀᴋ*\n\n> Hanya owner yang bisa menggunakan fitur ini!');

        const action = args[0]?.toLowerCase();
        const API_KEY = deviceConfig.nevapediaApiKey || config.nevapediaApiKey || 'apikeymu sendiri';
        const BASE_URL = 'https://app.nevapedia.com/api';

        const showMenu = () => {
            const txt = `┌˚₊ ๑│ ɴ ᴇ ᴠ ᴀ ᴘ ᴇ ᴅ ɪ ᴀ │๑˚₊ 💳\n` +
                      `┇ \n` +
                      `│ ✨ *Daftar Perintah (Nevapedia API):*\n` +
                      `│ \n` +
                      `│ ◦ *${prefix + command} balance* (Cek Saldo)\n` +
                      `│ ◦ *${prefix + command} invoice <nominal>* (Buat Invoice)\n` +
                      `│ ◦ *${prefix + command} cekinvoice <id_invoice>* (Cek Invoice)\n` +
                      `│ ◦ *${prefix + command} wdmethod* (List Metode WD)\n` +
                      `│ ◦ *${prefix + command} wd <nominal> <metode> <no_rek/akun> [instant(true/false)]* (Tarik Dana)\n` +
                      `│ ◦ *${prefix + command} cekwd <id_wd>* (Cek Status WD)\n` +
                      `┇ \n` +
                      `└˚₊ ๑ ────────────── ๑˚₊\n` +
                      `> © ERINE-AI`;
            return reply(txt);
        };

        if (!action) return showMenu();

        await react('⏳');

        try {
            switch (action) {
                case 'balance':
                case 'saldo': {
                    const res = await axios.get(`${BASE_URL}/balance?apikey=${API_KEY}`);
                    const data = res.data;
                    const txt = `┌˚₊ ๑│ ɴ ᴇ ᴠ ᴀ ᴘ ᴇ ᴅ ɪ ᴀ │๑˚₊ 💳\n` +
                              `┇ \n` +
                              `│ 👤 *Username:* ${data.username || '-'}\n` +
                              `│ 📧 *Email:* ${data.email || '-'}\n` +
                              `│ 💰 *Saldo:* Rp ${data.balance ? data.balance.toLocaleString('id-ID') : '0'}\n` +
                              `┇ \n` +
                              `└˚₊ ๑ ────────────── ๑˚₊\n` +
                              `> © ERINE-AI`;
                    await reply(txt);
                    break;
                }

                case 'invoice':
                case 'create': {
                    const amount = args[1];
                    if (!amount || isNaN(amount as any)) return reply(`❌ Masukkan nominal yang valid!\nContoh: *${prefix + command} invoice 50000*`);
                    
                    const res = await axios.get(`${BASE_URL}/invoice?apikey=${API_KEY}&amount=${amount}`);
                    const data = res.data;

                    if (!data.success && !data.invoice_id) throw new Error(data.message || 'Gagal membuat invoice');

                    const txt = `┌˚₊ ๑│ ɪ ɴ ᴠ ᴏ ɪ ᴄ ᴇ │๑˚₊ 🧾\n` +
                              `┇ \n` +
                              `│ 🆔 *ID Invoice:* ${data.invoice_id}\n` +
                              `│ 💰 *Nominal:* Rp ${data.amount.toLocaleString('id-ID')}\n` +
                              `│ 📉 *Fee:* Rp ${data.fee.toLocaleString('id-ID')}\n` +
                              `│ 💵 *Total Bayar:* Rp ${data.total.toLocaleString('id-ID')}\n` +
                              `│ ⏳ *Expired:* ${data.expired_at}\n` +
                              `│ 🔗 *Link Bayar:* ${data.payment_link || '-'}\n` +
                              `┇ \n` +
                              `└˚₊ ๑ ────────────── ๑˚₊\n` +
                              `> © ERINE-AI`;

                    if (data.qris_image) {
                        await sock.sendMessage(chatId, { image: { url: data.qris_image }, caption: txt }, { quoted: m });
                    } else {
                        await reply(txt);
                    }
                    break;
                }

                case 'cekinvoice':
                case 'statusinv': {
                    const invId = args[1];
                    if (!invId) return reply(`❌ Masukkan ID Invoice!\nContoh: *${prefix + command} cekinvoice 64c8d9e...*`);
                    
                    const res = await axios.get(`${BASE_URL}/invoice/status?apikey=${API_KEY}&invoice_id=${invId}`);
                    const data = res.data;

                    const txt = `┌˚₊ ๑│ ᴄ ᴇ ᴋ  ɪ ɴ ᴠ ᴏ ɪ ᴄ ᴇ │๑˚₊ 🔍\n` +
                              `┇ \n` +
                              `│ 🆔 *ID Invoice:* ${data.invoice_id}\n` +
                              `│ 📊 *Status:* ${data.status.toUpperCase()}\n` +
                              `│ 💰 *Nominal:* Rp ${data.amount.toLocaleString('id-ID')}\n` +
                              `│ 💵 *Total Bayar:* Rp ${data.total.toLocaleString('id-ID')}\n` +
                              `│ 📅 *Dibuat:* ${data.created_at}\n` +
                              `│ ⏳ *Expired:* ${data.expired_at}\n` +
                              `┇ \n` +
                              `└˚₊ ๑ ────────────── ๑˚₊\n` +
                              `> © ERINE-AI`;
                    await reply(txt);
                    break;
                }

                case 'wdmethod':
                case 'method': {
                    const res = await axios.get(`${BASE_URL}/withdraw/methods?apikey=${API_KEY}`);
                    const data = res.data;

                    let txt = `┌˚₊ ๑│ ᴍ ᴇ ᴛ ᴏ ᴅ ᴇ  ᴡ ᴅ │๑˚₊ 🏦\n┇ \n`;
                    
                    txt += `│ 📌 *Manual Methods:*\n`;
                    if (data.manual_methods && data.manual_methods.length > 0) {
                        data.manual_methods.forEach((m: any) => {
                            txt += `│ ◦ ${m.name} (${m.code}) - Fee: Rp${m.fee}\n`;
                        });
                    } else {
                        txt += `│ ◦ (Tidak tersedia)\n`;
                    }

                    txt += `│ \n│ ⚡ *Instant Methods:*\n`;
                    if (data.instant_methods && data.instant_methods.length > 0) {
                        data.instant_methods.forEach((m: any) => {
                            txt += `│ ◦ ${m.name} (${m.code}) - Fee: Rp${m.fee}\n`;
                        });
                    } else {
                        txt += `│ ◦ (Tidak tersedia)\n`;
                    }

                    txt += `┇ \n└˚₊ ๑ ────────────── ๑˚₊\n> © ERINE-AI`;
                    await reply(txt);
                    break;
                }

                case 'wd':
                case 'withdraw': {
                    const amount = args[1];
                    const method = args[2];
                    const accNum = args[3];
                    const instant = args[4] ? args[4].toLowerCase() : 'false';

                    if (!amount || !method || !accNum) {
                        return reply(`❌ Format salah!\nContoh: *${prefix + command} wd 50000 dana 08123456789 false*`);
                    }

                    const isInstant = (instant === 'true' || instant === 'instan') ? 'true' : 'false';
                    const res = await axios.get(`${BASE_URL}/withdraw?apikey=${API_KEY}&amount=${amount}&method=${method}&account_number=${accNum}&instant=${isInstant}`);
                    const data = res.data;

                    if (!data.success) throw new Error(data.message || 'Penarikan gagal.');

                    const wd = data.data;
                    const txt = `┌˚₊ ๑│ ᴡ ɪ ᴛ ʜ ᴅ ʀ ᴀ ᴡ │๑˚₊ 💸\n` +
                              `┇ \n` +
                              `│ 🆔 *ID WD:* ${wd.id}\n` +
                              `│ 🏦 *Metode:* ${wd.method}\n` +
                              `│ 🔢 *No Akun:* ${wd.account_number}\n` +
                              `│ 💰 *Nominal:* Rp ${wd.amount.toLocaleString('id-ID')}\n` +
                              `│ 📉 *Fee:* Rp ${wd.fee.toLocaleString('id-ID')}\n` +
                              `│ 📊 *Status:* ${wd.status.toUpperCase()}\n` +
                              `│ 📅 *Waktu:* ${wd.created_at}\n` +
                              `┇ \n` +
                              `└˚₊ ๑ ────────────── ๑˚₊\n` +
                              `> © ERINE-AI`;
                    await reply(txt);
                    break;
                }

                case 'cekwd':
                case 'statuswd': {
                    const wdId = args[1];
                    if (!wdId) return reply(`❌ Masukkan ID Withdraw!\nContoh: *${prefix + command} cekwd WDc4e3f2...*`);
                    
                    const res = await axios.get(`${BASE_URL}/withdraw/status?apikey=${API_KEY}&id=${wdId}`);
                    const data = res.data;

                    const txt = `┌˚₊ ๑│ ᴄ ᴇ ᴋ  ᴡ ᴅ │๑˚₊ 🔍\n` +
                              `┇ \n` +
                              `│ 🆔 *ID WD:* ${data.id}\n` +
                              `│ 🏦 *Metode:* ${data.method} (${data.account_number})\n` +
                              `│ 💰 *Nominal:* Rp ${data.amount.toLocaleString('id-ID')}\n` +
                              `│ 📊 *Status:* ${data.status.toUpperCase()}\n` +
                              `│ ⚡ *Tipe Instan:* ${data.instant ? 'Ya' : 'Tidak'}\n` +
                              `│ 📅 *Dibuat:* ${data.created_at || '-'}\n` +
                              `│ ✅ *Selesai:* ${data.completed_at || '-'}\n` +
                              `┇ \n` +
                              `└˚₊ ๑ ────────────── ๑˚₊\n` +
                              `> © ERINE-AI`;
                    await reply(txt);
                    break;
                }

                default:
                    showMenu();
            }

            await react('✅');

        } catch (e: any) {
            console.error(e);
            await react('❌');
            
            let errorMsg = e.message;
            if (e.response && e.response.data) {
                errorMsg = e.response.data.message || e.response.data.error || JSON.stringify(e.response.data);
            }
            
            await reply(`┌˚₊ ๑│ s ʏ s ᴛ ᴇ ᴍ   ᴇ ʀ ʀ ᴏ ʀ │๑˚₊ ❌\n┇ Gagal mengeksekusi perintah.\n│ *Detail:* ${errorMsg}\n└˚₊ ๑ ────────────── ๑˚₊\n> © ERINE-AI`);
        }
        return;
      }

      if (["antilinkgc", "antilinkwa", "algc", "antilinkgrup"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini khusus Admin grup!");
        
        await react('🔗');
        const db = getDatabase();
        const option = q?.toLowerCase()?.trim();
        
        if (!option) {
            const groupData = (await db.getGroup(chatId)) as GroupData || {}
            const status = groupData.antilinkgc || 'off'
            const mode = groupData.antilinkgcMode || 'remove'
            
            return reply(
                `🔗 *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ*\n\n` +
                `╭┈┈⬡「 📋 *sᴛᴀᴛᴜs* 」\n` +
                `┃ ◦ Status: *${status.toUpperCase()}*\n` +
                `┃ ◦ Mode: *${mode.toUpperCase()}*\n` +
                `╰┈┈⬡\n\n` +
                `*ᴅᴇᴛᴇᴋsɪ:*\n` +
                `> • chat.whatsapp.com (grup)\n` +
                `> • wa.me (kontak)\n` +
                `> • whatsapp.com/channel (saluran)\n\n` +
                `*ᴄᴀʀᴀ ᴘᴀᴋᴀɪ:*\n` +
                `> \`${prefix}antilinkgc on\` - Aktifkan\n` +
                `> \`${prefix}antilinkgc off\` - Nonaktifkan\n` +
                `> \`${prefix}antilinkgc metode kick\` - Mode kick user\n` +
                `> \`${prefix}antilinkgc metode remove\` - Mode hapus pesan`
            );
        }
        
        if (option === 'on') {
            await db.setGroup(chatId, { antilinkgc: 'on' })
            return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* diaktifkan!\n\n> Link WA akan dihapus otomatis.`)
        }
        
        if (option === 'off') {
            await db.setGroup(chatId, { antilinkgc: 'off' })
            return reply(`❌ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* dinonaktifkan!`)
        }
        
        if (option.startsWith('metode')) {
            const method = args[1]?.toLowerCase()
            if (method === 'kick') {
                await db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'kick' })
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode KICK diaktifkan!\n\n> User yang kirim link WA akan di-kick.`)
            } else if (method === 'remove' || method === 'delete') {
                await db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'remove' })
                return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode DELETE diaktifkan!\n\n> Pesan dengan link WA akan dihapus.`)
            } else {
                return reply(`❌ Metode tidak valid! Gunakan: \`kick\` atau \`remove\`\n\n> Contoh: \`${prefix}antilinkgc metode kick\``)
            }
        }

        if (option === 'kick') {
            await db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'kick' })
            return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode KICK diaktifkan!\n\n> User yang kirim link WA akan di-kick.`)
        }
        
        if (option === 'remove' || option === 'delete') {
            await db.setGroup(chatId, { antilinkgc: 'on', antilinkgcMode: 'remove' })
            return reply(`✅ *ᴀɴᴛɪʟɪɴᴋ ᴡᴀ* mode DELETE diaktifkan!\n\n> Pesan dengan link WA akan dihapus.`)
        }
        
        return reply(`❌ Opsi tidak valid! Gunakan: \`on\`, \`off\`, \`metode kick\`, \`metode remove\``)
      }

      if (["addantilink", "addalink", "addblocklink"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini khusus Admin grup!");
        
        await react('➕');
        const db = getDatabase()
        const link = q?.toLowerCase()?.trim()
        
        if (!link) {
            return reply(
                `🔗 *ᴀᴅᴅ ᴀɴᴛɪʟɪɴᴋ*\n\n` +
                `> Masukkan domain/pattern link yang ingin diblokir\n\n` +
                `\`Contoh:\`\n` +
                `\`${prefix}addantilink tiktok.com\`\n` +
                `\`${prefix}addantilink chat.whatsapp.com\`\n` +
                `\`${prefix}addantilink instagram.com\``
            )
        }
        
        const groupData = (await db.getGroup(chatId)) || {}
        const antilinkList = groupData.antilinkList || []
        
        if (antilinkList.includes(link)) {
            return reply(`⚠️ Link \`${link}\` sudah ada di daftar antilink!`)
        }
        
        antilinkList.push(link)
        db.setGroup(chatId, { antilinkList })
        
        return reply(
            `✅ *ᴀɴᴛɪʟɪɴᴋ ᴅɪᴛᴀᴍʙᴀʜ*\n\n` +
            `> Link: \`${link}\`\n` +
            `> Total: *${antilinkList.length}* link\n\n` +
            `> Gunakan \`${prefix}listantilink\` untuk melihat daftar`
        )
      }

      if (["delantilink", "remantilink", "delalink", "delblocklink"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini khusus Admin grup!");
        
        await react('🗑️');
        const db = getDatabase()
        const link = q?.toLowerCase()?.trim()
        
        const groupData = (await db.getGroup(chatId)) || {}
        const antilinkList = groupData.antilinkList || []
        
        if (!link) {
            if (antilinkList.length === 0) {
                return reply(`📋 Daftar antilink kosong!`)
            }
            
            let txt = `🔗 *ᴅᴀꜰᴛᴀʀ ᴀɴᴛɪʟɪɴᴋ*\n\n`
            antilinkList.forEach((l: string, i: number) => {
                txt += `> ${i + 1}. \`${l}\`\n`
            })
            txt += `\n> Total: *${antilinkList.length}* link`
            txt += `\n\n\`${prefix}delantilink <domain>\` untuk hapus`
            
            return reply(txt)
        }
        
        const index = antilinkList.findIndex((l: string) => l === link)
        
        if (index === -1) {
            return reply(`⚠️ Link \`${link}\` tidak ditemukan di daftar antilink!`)
        }
        
        antilinkList.splice(index, 1)
        db.setGroup(chatId, { antilinkList })
        
        return reply(
            `✅ *ᴀɴᴛɪʟɪɴᴋ ᴅɪʜᴀᴘᴜs*\n\n` +
            `> Link: \`${link}\`\n` +
            `> Sisa: *${antilinkList.length}* link`
        )
      }

      if (["welcome", "wc"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");

        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        const sub = q?.trim().toLowerCase();
        const currentStatus = groupData.welcome === true;

        if (sub === "on") {
          if (currentStatus) return reply(`⚠️ Welcome sudah aktif di grup ini.`);
          await db.setGroup(chatId, { welcome: true });
          return reply(`✅ Welcome message berhasil diaktifkan!`);
        }
        if (sub === "off") {
          if (!currentStatus) return reply(`⚠️ Welcome sudah nonaktif di grup ini.`);
          db.setGroup(chatId, { welcome: false });
          return reply(`❌ Welcome message berhasil dinonaktifkan.`);
        }

        return reply(
          `👋 *ᴡᴇʟᴄᴏᴍᴇ sᴇᴛᴛɪɴɢs*\n\n` +
          `> Status: *${currentStatus ? "✅ ON" : "❌ OFF"}*\n\n` +
          `> \`${prefix}welcome on\` → Aktifkan\n` +
          `> \`${prefix}welcome off\` → Nonaktifkan\n` +
          `> \`${prefix}setwelcome <text>\` → Custom pesan\n` +
          `> \`${prefix}resetwelcome\` → Reset default`
        );
      }

      if (["goodbye", "gb"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");

        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) as GroupData || {};
        const sub = q?.trim().toLowerCase();
        const currentStatus = groupData.goodbye === true;

        if (sub === "on") {
          if (currentStatus) return reply(`⚠️ Goodbye sudah aktif di grup ini.`);
          await db.setGroup(chatId, { goodbye: true });
          return reply(`✅ Goodbye message berhasil diaktifkan!`);
        }
        if (sub === "off") {
          if (!currentStatus) return reply(`⚠️ Goodbye sudah nonaktif di grup ini.`);
          db.setGroup(chatId, { goodbye: false });
          return reply(`❌ Goodbye message berhasil dinonaktifkan.`);
        }

        return reply(
          `👋 *ɢᴏᴏᴅʙʏᴇ sᴇᴛᴛɪɴɢs*\n\n` +
          `> Status: *${currentStatus ? "✅ ON" : "❌ OFF"}*\n\n` +
          `> \`${prefix}goodbye on\` → Aktifkan\n` +
          `> \`${prefix}goodbye off\` → Nonaktifkan\n` +
          `> \`${prefix}setgoodbye <text>\` → Custom pesan\n` +
          `> \`${prefix}resetgoodbye\` → Reset default`
        );
      }

      if (["testwelcome", "testwelcomecard"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");
        
        await react('⏳');
        try {
          const db = getDatabase();
          const groupData = (await db.getGroup(chatId)) || {};
          
          const metadata = await sock.groupMetadata(chatId);
          const groupName = metadata.subject;
          const participantsCount = metadata.participants.length;
          const userName = sender.split("@")[0];
          
          let ppUrl = "https://cdn.gimita.id/download/pp%20kosong%20wa%20default%20(1)_1769506608569_52b57f5b.jpg";
          try {
            ppUrl = await sock.profilePictureUrl(sender, "image");
          } catch {}

          const canvasBuffer = await createWelcomeCardV4(userName, ppUrl, groupName, participantsCount);

          const now = moment().tz("Asia/Jakarta");
          const dayNames: { [key: string]: string } = {
            Sunday: "Minggu", Monday: "Senin", Tuesday: "Selasa", Wednesday: "Rabu",
            Thursday: "Kamis", Friday: "Jumat", Saturday: "Sabtu",
          };
          const dayId = dayNames[now.format("dddd")] || now.format("dddd");

          const replacePlaceholders = (text: string) => {
            return text
              .replace(/{user}/gi, `@${userName}`)
              .replace(/{number}/gi, userName)
              .replace(/{group}/gi, groupName)
              .replace(/@group/gi, groupName)
              .replace(/{desc}/gi, metadata.desc || "")
              .replace(/{count}/gi, participantsCount.toString())
              .replace(/{owner}/gi, metadata.owner ? metadata.owner.split("@")[0] : "Admin")
              .replace(/{date}/gi, now.format("DD/MM/YYYY"))
              .replace(/{time}/gi, now.format("HH:mm"))
              .replace(/{day}/gi, dayId)
              .replace(/{bot}/gi, "CMNTY-BOT")
              .replace(/{prefix}/gi, ".");
          };

          let welcomeMsg = groupData.welcomeMsg || `Welcome @${userName} to ${groupName}! ✨\n\nSemoga betah yahh, di grup @group\n\n> Gunakan .menu untuk melihat fitur bot`;
          welcomeMsg = replacePlaceholders(welcomeMsg);

          await sock.sendMessage(chatId, {
            image: canvasBuffer,
            caption: welcomeMsg,
            contextInfo: {
              mentionedJid: [sender],
              forwardingScore: 99,
              isForwarded: true,
              forwardedNewsletterMessageInfo: {
                newsletterJid: "120363426467190619@newsletter",
                newsletterName: "CMNTY-BOT",
                serverMessageId: 1
              }
            }
          });
          await react('✅');
        } catch (err: any) {
          await react('❌');
          reply(`❌ Error: ${err.message}`);
        }
        return;
      }

      if (["setwelcome"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");
        if (!q) {
          return reply(
            `📝 *sᴇᴛ ᴡᴇʟᴄᴏᴍᴇ*\n\n` +
            `╭┈┈⬡「 📋 *ᴘʟᴀᴄᴇʜᴏʟᴅᴇʀ* 」\n` +
            `┃ ◦ \`{user}\` - Nama member\n` +
            `┃ ◦ \`{number}\` - Nomor member\n` +
            `┃ ◦ \`{group}\` - Nama grup\n` +
            `┃ ◦ \`{desc}\` - Deskripsi grup\n` +
            `┃ ◦ \`{count}\` - Jumlah member\n` +
            `┃ ◦ \`{owner}\` - Nama owner grup\n` +
            `┃ ◦ \`{date}\` - Tanggal (DD/MM/YYYY)\n` +
            `┃ ◦ \`{time}\` - Waktu (HH:mm)\n` +
            `┃ ◦ \`{day}\` - Hari (Senin, Selasa, dll)\n` +
            `┃ ◦ \`{bot}\` - Nama bot\n` +
            `┃ ◦ \`{prefix}\` - Prefix bot\n` +
            `╰┈┈⬡\n\n` +
            `\`Contoh:\`\n` +
            `\`${prefix}setwelcome Halo {user}! 👋\`\n` +
            `\`Selamat datang di {group} pada {day}, {date}\``
          );
        }
        db.setGroup(chatId, { welcomeMsg: q, welcome: true });
        await react("✅");
        return reply(`✅ Welcome berhasil di set menjadi *${q}*\nMau reset? ketik ${prefix}resetwelcome`);
      }

      if (["setgoodbye"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");
        if (!q) {
          return reply(
            `📝 *sᴇᴛ ɢᴏᴏᴅʙʏᴇ*\n\n` +
            `╭┈┈⬡「 📋 *ᴘʟᴀᴄᴇʜᴏʟᴅᴇʀ* 」\n` +
            `┃ ◦ \`{user}\` - Nama member\n` +
            `┃ ◦ \`{number}\` - Nomor member\n` +
            `┃ ◦ \`{group}\` - Nama grup\n` +
            `┃ ◦ \`{count}\` - Jumlah member\n` +
            `┃ ◦ \`{date}\` - Tanggal (DD/MM/YYYY)\n` +
            `┃ ◦ \`{time}\` - Waktu (HH:mm)\n` +
            `┃ ◦ \`{day}\` - Hari (Senin, Selasa, dll)\n` +
            `╰┈┈⬡\n\n` +
            `\`Contoh:\`\n` +
            `\`${prefix}setgoodbye Selamat tinggal {user}! 👋\``
          );
        }
        db.setGroup(chatId, { goodbyeMsg: q, goodbye: true });
        await react("✅");
        return reply(`✅ Goodbye berhasil di set menjadi *${q}*\nMau reset? ketik ${prefix}resetgoodbye`);
      }

      if (["resetwelcome"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) as GroupData || {};
        if (!groupData.welcomeMsg) {
          return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Welcome message sudah default`);
        }

        db.setGroup(chatId, { welcomeMsg: null });
        await react("✅");
        return reply(`✅ *ᴡᴇʟᴄᴏᴍᴇ ᴅɪʀᴇsᴇᴛ*\n\n> Kembali ke pesan default`);
      }

      if (["resetgoodbye"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini hanya untuk Admin grup!");
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        if (!groupData.goodbyeMsg) {
          return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Goodbye message sudah default`);
        }

        db.setGroup(chatId, { goodbyeMsg: null });
        await react("✅");
        return reply(`✅ *ɢᴏᴏᴅʙʏᴇ ᴅɪʀᴇsᴇᴛ*\n\n> Kembali ke pesan default`);
      }

      if (["listantilink", "cekantilink", "antilinklist"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        if (!isAdmin && !isOwner) return reply("❌ Fitur ini khusus Admin grup!");
        
        await react('📋');
        const db = getDatabase()
        const groupData = (await db.getGroup(chatId)) || {}
        const customList = groupData.antilinkList || []
        
        let txt = `🔗 *ᴅᴀꜰᴛᴀʀ ᴀɴᴛɪʟɪɴᴋ*\n\n`
        
        txt += `╭┈┈⬡「 📌 *ᴅᴇꜰᴀᴜʟᴛ* 」\n`
        DEFAULT_BLOCKED_LINKS.forEach((l, i) => {
            txt += `┃ ${i + 1}. \`${l}\`\n`
        })
        txt += `╰┈┈┈┈┈┈┈┈⬡\n\n`
        
        if (customList.length > 0) {
            txt += `╭┈┈⬡「 ➕ *ᴄᴜsᴛᴏᴍ* 」\n`
            customList.forEach((l: string, i: number) => {
                txt += `┃ ${i + 1}. \`${l}\`\n`
            })
            txt += `╰┈┈┈┈┈┈┈┈⬡\n\n`
        }
        
        txt += `> Default: *${DEFAULT_BLOCKED_LINKS.length}* link\n`
        txt += `> Custom: *${customList.length}* link\n\n`
        txt += `\`${prefix}addantilink <link>\` untuk tambah\n`
        txt += `\`${prefix}delantilink <link>\` untuk hapus`
        
        return reply(txt)
      }






      const DEFAULT_INTRO = `halo kak @user 🖐

Kenalan dulu yukk
- Nama : 
- Umur : 
- Asal : 
- Hobi : 
- Status : 

Semoga betah yahh, di grup @group

> Untuk Admin:
ganti intro bawaan dengan .setintro <text>`;

      if (["intro", "perkenalan", "selamatdatang"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        const groupMeta = await sock.groupMetadata(chatId).catch(() => null);
        
        const introText = groupData?.intro || "Selamat datang di @group!\n\nSemoga betah yahh, di grup @group\n\n> Untuk Admin:\nganti intro bawaan dengan .setintro <text>";
        
        const now = moment().tz('Asia/Jakarta');
        const dateStr = now.format('D MMMM YYYY');
        const timeStr = now.format('HH:mm');
        
        const parsed = introText
            .replace(/@user/gi, `@${sender.split('@')[0]}`)
            .replace(/@group/gi, groupMeta?.subject || 'Grup')
            .replace(/@count/gi, groupMeta?.participants?.length || '0')
            .replace(/@date/gi, dateStr)
            .replace(/@time/gi, timeStr)
            .replace(/@desc/gi, groupMeta?.desc || 'Tidak ada deskripsi')
            .replace(/@botname/gi, config.bot.name);
            
        await sock.sendMessage(chatId, { text: parsed, mentions: [sender], contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
      }

      if (["setintro", "setperkenalan", "introset"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        const groupMeta = await sock.groupMetadata(chatId).catch(() => null);
        const participants = groupMeta?.participants || [];
        const isAdmin = participants.find((p: any) => p.id === sender)?.admin || isOwner;
        
        if (!isAdmin) return reply("❌ Fitur ini khusus Admin grup!");
        
        if (!q) {
            return reply(
                `📝 *sᴇᴛ ɪɴᴛʀᴏ*\n\n` +
                `> Masukkan pesan intro!\n\n` +
                `*Placeholder yang tersedia:*\n` +
                `> @user - Nama pengguna\n` +
                `> @group - Nama grup\n` +
                `> @count - Jumlah member\n` +
                `> @date - Tanggal hari ini\n` +
                `> @time - Waktu sekarang\n` +
                `> @desc - Deskripsi grup\n` +
                `> @botname - Nama bot\n\n` +
                `*Contoh:*\n` +
                `> ${prefix}setintro Selamat datang @user di grup @group! 👋`
            );
        }
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        groupData.intro = q;
        db.setGroup(chatId, groupData);
        
        await reply(
            `✅ *ɪɴᴛʀᴏ ᴅɪsᴀᴠᴇ!*\n` +
            `Pesan intro grup berhasil diubah.\n` +
            `Ketik *${prefix}intro* untuk melihat hasilnya.`
        );
        return;
      }

      if (["resetintro", "introdel", "delintro", "deleteintro"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        const groupMeta = await sock.groupMetadata(chatId).catch(() => null);
        const participants = groupMeta?.participants || [];
        const isAdmin = participants.find((p: any) => p.id === sender)?.admin || isOwner;
        
        if (!isAdmin) return reply("❌ Fitur ini khusus Admin grup!");
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        
        if (!groupData.intro) {
            return reply(`❌ Grup ini sudah menggunakan intro default!`);
        }
        
        delete groupData.intro;
        db.setGroup(chatId, groupData);
        
        await reply(
            `✅ *ɪɴᴛʀᴏ ᴅɪʀᴇsᴇᴛ!*\n` +
            `Intro grup dikembalikan ke default.\n\n` +
            `Ketik *${prefix}intro* untuk melihat hasilnya.`
        );
        return;
      }

      const DEFAULT_GROUP_RULES = `📜 *ᴀᴛᴜʀᴀɴ ɢʀᴜᴘ*

┃ 1️⃣ Dilarang spam/flood chat
┃ 2️⃣ Dilarang promosi tanpa izin
┃ 3️⃣ Dilarang konten SARA/Porn
┃ 4️⃣ Hormati sesama member
┃ 5️⃣ Gunakan bahasa yang sopan
┃ 6️⃣ Dilarang share link tanpa izin
┃ 7️⃣ Patuhi instruksi admin
┃ 8️⃣ No toxic & bullying

_Mau langgar? Siap-siap di Kick!_`;

      if (["rulesgrup", "grouprules", "aturangrup", "grules"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        const rulesText = groupData.groupRules || DEFAULT_GROUP_RULES;

        const imagePath = path.join(process.cwd(), 'assets', 'images', 'ourin-rules.jpg');
        let imageBuffer = fs.existsSync(imagePath) ? fs.readFileSync(imagePath) : null;

        if (imageBuffer) {
            await sock.sendMessage(m.key.remoteJid!, { image: imageBuffer, caption: rulesText, contextInfo: getContextInfo(deviceConfig, m) }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        } else {
            await reply(rulesText);
        }
        return;
      }

      if (["setrulesgrup", "setgrouprules", "setaturangrup"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        const groupMeta = await sock.groupMetadata(chatId).catch(() => null);
        const participants = groupMeta?.participants || [];
        const isAdmin = participants.find((p: any) => p.id === sender)?.admin || isOwner;
        
        if (!isAdmin) return reply("❌ Fitur ini khusus Admin grup!");
        
        if (!q) {
            return reply(
                `📝 *sᴇᴛ ɢʀᴜᴘ ʀᴜʟᴇs*\n\n` +
                `> Masukkan teks rules yang baru\n\n` +
                `\`Contoh:\`\n` +
                `\`${prefix}setrulesgrup 1. Jangan spam\\n2. Hormati sesama\``
            );
        }
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        groupData.groupRules = q;
        db.setGroup(chatId, groupData);
        
        await reply(
            `✅ *ɢʀᴜᴘ ʀᴜʟᴇs ᴅɪᴜᴘᴅᴀᴛᴇ!*\n\n` +
            `Rules grup berhasil diubah!\n` +
            `Ketik \`${prefix}rulesgrup\` untuk melihat.`
        );
        return;
      }

      if (["resetrulesgrup", "resetgrouprules"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        const groupMeta = await sock.groupMetadata(chatId).catch(() => null);
        const participants = groupMeta?.participants || [];
        const isAdmin = participants.find((p: any) => p.id === sender)?.admin || isOwner;
        
        if (!isAdmin) return reply("❌ Fitur ini khusus Admin grup!");
        
        const db = getDatabase();
        const groupData = (await db.getGroup(chatId)) || {};
        
        if (!groupData.groupRules) {
            return reply(`❌ Grup ini sudah menggunakan rules default!`);
        }
        
        delete groupData.groupRules;
        db.setGroup(chatId, groupData);
        
        await reply(
            `✅ *ɢʀᴜᴘ ʀᴜʟᴇs ᴅɪʀᴇsᴇᴛ!*\n` +
            `Rules grup dikembalikan ke default.\n\n` +
            `Ketik \`${prefix}rulesgrup\` untuk melihat.`
        );
        return;
      }

      if (["leave", "leavegrup", "leavegroup", "keluar", "bye"].includes(command || "")) {
        if (!isOwner) return reply("❌ Fitur ini khusus Owner!");
        
        let targetGroupJid = null;
        let groupName = '';
        
        if (!q && isGroup) {
            targetGroupJid = chatId;
            try {
                const meta = await sock.groupMetadata(chatId);
                groupName = meta.subject || 'Grup ini';
            } catch {
                groupName = 'Grup ini';
            }
        } else if (q) {
            const patterns = [
                /chat\.whatsapp\.com\/([a-zA-Z0-9]{20,})/i,
                /wa\.me\/([a-zA-Z0-9]{20,})/i
            ];
            let inviteCode = null;
            for (const pattern of patterns) {
                const match = q.match(pattern);
                if (match) { inviteCode = match[1]; break; }
            }
            
            if (!inviteCode) {
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Link invite tidak valid`);
            }
            
            try {
                const groupInfo = await sock.groupGetInviteInfo(inviteCode);
                targetGroupJid = groupInfo.id;
                groupName = groupInfo.subject || 'Unknown';
            } catch (error) {
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Tidak dapat mengambil info grup dari link`);
            }
        } else {
            return reply(
                `🚪 *ʟᴇᴀᴠᴇ ɢʀᴜᴘ*\n\n` +
                `╭┈┈⬡「 📋 *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ* 」\n` +
                `┃ ◦ Di grup: \`${prefix}leave\`\n` +
                `┃ ◦ Via link: \`${prefix}leave <link>\`\n` +
                `╰┈┈⬡\n\n` +
                `\`Contoh: ${prefix}leave https://chat.whatsapp.com/xxx\``
            );
        }
        
        if (!targetGroupJid) {
            return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Grup tidak ditemukan`);
        }
        
        await react('🕕');
        
        try {
            const saluranId = config.channel.id;
            const saluranName = config.channel.name;
            
            if (isGroup && targetGroupJid === chatId) {
                await sock.sendMessage(chatId, {
                    text: `👋 *ɢᴏᴏᴅʙʏᴇ*\n\n` +
                        `> Bot akan keluar dari grup ini.\n` +
                        `> Terima kasih sudah menggunakan bot!`,
                    contextInfo: {
                        forwardingScore: 9999,
                        isForwarded: true,
                        forwardedNewsletterMessageInfo: {
                            newsletterJid: saluranId,
                            newsletterName: saluranName,
                            serverMessageId: 127
                        }
                    }
                });
            }
            
            await sock.groupLeave(targetGroupJid);
            
            if (!isGroup || targetGroupJid !== chatId) {
                await react('✅');
                await reply(
                    `✅ *ʙᴇʀʜᴀsɪʟ ᴋᴇʟᴜᴀʀ*\n\n` +
                    `> Bot telah keluar dari: *${groupName}*`
                );
            }
            
        } catch (error) {
            await react('☢');
            await reply(`❌ *Gagal keluar dari grup*`);
        }
        return;
      }

      if (["swgc", "statusgrup", "swgroup"].includes(command || "")) {
        if (!isOwner) return reply("❌ Fitur ini khusus Owner!");
        
        let rawContent: any = {};
        let buffer: Buffer | null = null;
        let ext: string | undefined;
        let tempFile: string | undefined;
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        
        const typeMedia = getContentType(msg);
        const isQuotedMedia = typeMedia === "extendedTextMessage" && (msg.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage || msg.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage);
        const isMedia = typeMedia === "imageMessage" || typeMedia === "videoMessage";

        if (isMedia || isQuotedMedia) {
            try {
                const target = isQuotedMedia ? (msg.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage || msg.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage) : (msg.imageMessage || msg.videoMessage);
                const mediaType = (isQuotedMedia ? (msg.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ? "image" : "video") : (msg.imageMessage ? "image" : "video"));
                
                const stream = await downloadContentFromMessage(target as any, mediaType as any);
                buffer = Buffer.alloc(0);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                
                if (!buffer) return reply(`❌ Gagal mengambil media.`);
                
                const fileType = await fileTypeFromBuffer(buffer);
                ext = fileType?.ext || 'bin';
                tempFile = path.join(tempDir, `swgc_${Date.now()}.${ext}`);
                fs.writeFileSync(tempFile, buffer);
                
                if (mediaType === "image") {
                    rawContent.image = buffer;
                    rawContent.caption = q || '';
                } else {
                    rawContent.video = buffer;
                    rawContent.caption = q || '';
                }
            } catch (e: any) {
                return reply(`❌ Gagal mendownload media: ${e.message}`);
            }
        } else if (q && q.trim()) {
            rawContent.text = q;
            rawContent.font = 0;
            rawContent.backgroundColor = '#128C7E';
        } else {
            return reply(
                `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ sᴡɢᴄ*\n\n` +
                `Fitur ini digunakan untuk mengirim status/story secara otomatis ke seluruh grup yang bot ikuti.\n\n` +
                `> \`${prefix}swgc teks\` : Story teks (Contoh: \`${prefix}swgc Halo Gais!\`)\n` +
                `> Reply gambar/video + \`${prefix}swgc\` : Up media ke story.\n` +
                `> Kirim gambar/video + caption \`${prefix}swgc\` : Up media ke story.\n\n` +
                `*Catatan:* Khusus Owner dan akan dikirim ke semua grup.`
            );
        }
        
        await react('🕕');
        try {
            const groups = await sock.groupFetchAllParticipating();
            const groupJids = Object.keys(groups);
            
            if (groupJids.length === 0) {
                return reply(`⚠️ *Bot tidak berada di grup manapun.*`);
            }
            
            await reply(`⏳ Sedang mengirim story ke *${groupJids.length}* grup...`);
            
            let success = 0;
            let fail = 0;
            
            for (const jid of groupJids) {
                try {
                    let content: any = {};
                    if (rawContent.image) {
                        content = { image: rawContent.image, caption: rawContent.caption || '' };
                    } else if (rawContent.video) {
                        content = { video: rawContent.video, caption: rawContent.caption || '' };
                    } else if (rawContent.text) {
                        content = { text: rawContent.text };
                    }
                    
                    await sendGroupStatus(sock, jid, content);
                    success++;
                } catch (e) {
                    fail++;
                }
            }
            
            await reply(`✅ *ᴘʀᴏsᴇs sᴇʟᴇsᴀɪ*\n\n> Berhasil: *${success}*\n> Gagal: *${fail}*\n> Total: *${groupJids.length}*`);
            
            if (tempFile && fs.existsSync(tempFile)) {
                setTimeout(() => {
                    try { fs.unlinkSync(tempFile!) } catch (e) {}
                }, 5000);
            }
            
        } catch (error: any) {
            reply(`❌ *ᴇʀʀᴏʀ*\n\n> Gagal broadcast status.\n> _${error.message}_`);
            if (tempFile && fs.existsSync(tempFile)) {
                try { fs.unlinkSync(tempFile) } catch (e) {}
            }
        }
        return;
      }

      if (command === "cancelswgc") {
        if (!isOwner) return;
        const pending = pendingSwgc.get(sender);
        if (pending) {
            if (pending.tempFile && fs.existsSync(pending.tempFile)) {
                try { fs.unlinkSync(pending.tempFile) } catch (e) {}
            }
            pendingSwgc.delete(sender);
            return reply("✅ Berhasil membatalkan post status grup.");
        }
        return reply("❌ Tidak ada status grup yang sedang dalam proses.");
      }



    if (["ipwho", "ip", "iplookup", "ipinfo"].includes(command || "")) {
      const ip = args[0];
      
      if (!ip) {
        return reply(
          `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n` +
          `> \`${prefix}ipwho <ip>\`\n\n` +
          `> Contoh:\n` +
          `> \`${prefix}${command} 8.8.8.8\``
        );
      }
      
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
      if (!ipRegex.test(ip)) {
        return reply(`❌ *ғᴏʀᴍᴀᴛ ᴛɪᴅᴀᴋ ᴠᴀʟɪᴅ*\n\n> Contoh: \`8.8.8.8\``);
      }
      
      await react('🕕');
      await reply(`🕕 *ᴍᴇɴᴄᴀʀɪ ɪɴꜰᴏ ɪᴘ...*`);
      try {
        const res = await axios.get(`https://ipwho.is/${ip}`, { timeout: 20000 });
        const data = res.data;
        
        if (!data.success) {
          await react('❌');
          return reply(`❌ *ɪᴘ ᴛɪᴅᴀᴋ ᴅɪᴛᴇᴍᴜᴋᴀɴ*\n\n> IP ${ip} tidak ditemukan atau tidak valid`);
        }
        if (data.latitude && data.longitude) {
          await sock.sendMessage(chatId, {
            location: {
              degreesLatitude: data.latitude,
              degreesLongitude: data.longitude
            }
          }, { quoted: m });
        }
        
        const text = `🌐 *ɪᴘ ʟᴏᴏᴋᴜᴘ*\n\n` +
            `╭┈┈⬡「 📍 *ʟᴏᴋᴀsɪ* 」\n` +
            `┃ 🔢 IP: ${data.ip}\n` +
            `┃ 🌍 Country: ${data.country} ${data.country_code}\n` +
            `┃ 🏙️ City: ${data.city || '-'}\n` +
            `┃ 📍 Region: ${data.region || '-'}\n` +
            `┃ 🌐 Continent: ${data.continent || '-'}\n` +
            `┃ 📮 Postal: ${data.postal || '-'}\n` +
            `┃ ⏰ Timezone: ${data.timezone?.id || '-'}\n` +
            `╰┈┈┈┈┈┈┈┈⬡\n\n` +
            `╭┈┈⬡「 🔌 *ᴋᴏɴᴇᴋsɪ* 」\n` +
            `┃ 🏢 ISP: ${data.connection?.isp || '-'}\n` +
            `┃ 🌐 ORG: ${data.connection?.org || '-'}\n` +
            `┃ 📡 ASN: ${data.connection?.asn || '-'}\n` +
            `╰┈┈┈┈┈┈┈┈⬡\n\n` +
            `╭┈┈⬡「 🛡️ *sᴇᴄᴜʀɪᴛʏ* 」\n` +
            `┃ 🔒 VPN: ${data.security?.vpn ? '✅ Yes' : '❌ No'}\n` +
            `┃ 🌐 Proxy: ${data.security?.proxy ? '✅ Yes' : '❌ No'}\n` +
            `┃ 🤖 Tor: ${data.security?.tor ? '✅ Yes' : '❌ No'}\n` +
            `╰┈┈┈┈┈┈┈┈⬡`;
        
        await react('✅');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
          text: text,
          contextInfo: getContextInfo(deviceConfig, m, null, true, true)
        }, { quoted: vQuoted as any });
        
      } catch (e: any) {
        await react('☢');
        reply(`❌ Gagal mengambil info IP: ${e.message}`);
      }
      return;
    }

    if (["lookup", "dnslookup", "dns", "whois"].includes(command || "")) {
      let domain = args[0];
      
      if (!domain) {
        return reply(
          `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n` +
          `> \`${prefix}lookup <domain>\`\n\n` +
          `> Contoh:\n` +
          `> \`${prefix}lookup google.com\``
        );
      }
      
      domain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
      
      if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]?(\.[a-zA-Z]{2,})+$/.test(domain)) {
        return reply(`❌ *ғᴏʀᴍᴀᴛ ᴛɪᴅᴀᴋ ᴠᴀʟɪᴅ*\n\n> Contoh: \`google.com\``);
      }
      
      await react('🕕');
      await reply(`🕕 *ᴍᴇɴᴄᴀʀɪ ɪɴꜰᴏ ᴅᴏᴍᴀɪɴ...*`);
      
      try {
        const [dnsRes, whoisRes] = await Promise.allSettled([
          axios.get(`https://api.hackertarget.com/dnslookup/?q=${domain}`).then(r => r.data),
          axios.get(`https://api.hackertarget.com/whois/?q=${domain}`).then(r => r.data)
        ]);
        
        const dnsData = dnsRes.status === 'fulfilled' ? dnsRes.value : null;
        const whoisData = whoisRes.status === 'fulfilled' ? whoisRes.value : null;
        
        if (!dnsData && !whoisData) {
          await react('❌');
          return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Tidak dapat memproses domain`);
        }
        
        let text = `🔍 *ᴅɴs ʟᴏᴏᴋᴜᴘ*\n\n`
        text += `> Domain: \`${domain}\`\n\n`
        
        if (dnsData && !dnsData.includes('error')) {
          const lines = dnsData.split('\n').filter((l: string) => l.trim());
          const records: any = {};
          
          lines.forEach((line: string) => {
            const parts = line.split(/\s+/);
            if (parts.length >= 2) {
              const type = parts[parts.length - 2] || 'OTHER';
              const value = parts[parts.length - 1];
              if (!records[type]) records[type] = [];
              records[type].push(value);
            }
          });
          
          text += `╭┈┈⬡「 📋 *ᴅɴs ʀᴇᴄᴏʀᴅs* 」\n`
          if (records['A']) text += `┃ 🅰️ A: ${records['A'].slice(0, 3).join(', ')}\n`
          if (records['AAAA']) text += `┃ 🔢 AAAA: ${records['AAAA'].slice(0, 2).join(', ')}\n`
          if (records['MX']) text += `┃ 📧 MX: ${records['MX'].slice(0, 2).join(', ')}\n`
          if (records['NS']) text += `┃ 🌐 NS: ${records['NS'].slice(0, 3).join(', ')}\n`
          if (records['TXT']) text += `┃ 📝 TXT: ${records['TXT'].length} records\n`
          text += `╰┈┈┈┈┈┈┈┈⬡\n\n`
        }
        
        if (whoisData && !whoisData.includes('error') && whoisData.length < 2000) {
          const registrar = whoisData.match(/Registrar:\s*(.+)/i)?.[1] || '-';
          const created = whoisData.match(/Creation Date:\s*(.+)/i)?.[1] || '-';
          const expires = whoisData.match(/Expir.*Date:\s*(.+)/i)?.[1] || '-';
          const nameservers = whoisData.match(/Name Server:\s*(.+)/gi)?.slice(0, 2).map((ns: string) => ns.split(':')[1]?.trim()) || [];
          
          text += `╭┈┈⬡「 📄 *ᴡʜᴏɪs* 」\n`
          text += `┃ 🏢 Registrar: ${registrar.slice(0, 35)}\n`
          text += `┃ 📅 Created: ${created.slice(0, 20)}\n`
          text += `┃ ⏰ Expires: ${expires.slice(0, 20)}\n`
          if (nameservers.length > 0) text += `┃ 🌐 NS: ${nameservers.join(', ')}\n`
          text += `╰┈┈┈┈┈┈┈┈⬡`
        }
        
        await react('✅');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
          text: text,
          contextInfo: getContextInfo(deviceConfig, m, null, true, true)
        }, { quoted: vQuoted as any });
        
      } catch (e: any) {
        await react('☢');
        reply(`❌ Terjadi kesalahan: ${e.message}`);
      }
      return;
    }
    if (["qrcustom", "qrcode", "qr"].includes(command || "")) {
      const data = q || (m.message?.imageMessage?.caption || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage?.caption || "").replace(new RegExp(`^\\${prefix}${command}`, 'i'), '').trim();
      
      if (!data) {
        return reply(
          `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n` +
          `> \`${prefix}qrcustom <url/text>\`\n\n` +
          `*Contoh:*\n` +
          `> \`${prefix}qrcustom https://wa.me/628xxx\`\n\n` +
          `💡 Reply gambar untuk custom logo di tengah QR`
        );
      }
      
      await react('🕕');
      await reply(`🕕 *Generating QR code...*`);
      
      try {
        let imageUrl = '';
        const typeMedia = Object.keys(m.message || {})[0];
        const isQuotedImage = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
        const isImage = !!m.message?.imageMessage;

        if (isImage || isQuotedImage) {
            const target = isQuotedImage ? m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage : m.message.imageMessage;
            const stream = await downloadContentFromMessage(target as any, "image");
            let buffer = Buffer.alloc(0);
            for await (const chunk of stream) {
              buffer = Buffer.concat([buffer, chunk]);
            }
            if (buffer.length > 0) {
              imageUrl = await uploadTo0x0(buffer) || '';
            }
        }
        
        const params = new URLSearchParams({
            data: data,
            type: 'png',
            size: '300'
        });
        
        if (imageUrl) {
            params.append('image', imageUrl);
        }
        
        const apiUrl = `https://api.denayrestapi.xyz/api/v1/tools/qrcustom?${params.toString()}`;
        
        await react('📱');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
            image: { url: apiUrl },
            caption: `📱 *QR Code*\n> ${data.substring(0, 50)}${data.length > 50 ? '...' : ''}`,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: vQuoted as any });
        
      } catch (err: any) {
        await react('☢');
        reply(`❌ Terjadi kesalahan: ${err.message}`);
      }
      return;
    }

    if (["readmore", "selengkapnya", "spoiler"].includes(command || "")) {
      if (!q) {
        return reply(`⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n> \`${prefix}${command} <teks_awal>|<teks_akhir>\`\n\n*Contoh:*\n> \`${prefix}${command} Halo|Ini teks tersembunyi\``);
      }
      
      let [l, r] = q.split('|');
      if (!l) l = '';
      if (!r) r = '';
      
      const readmore = String.fromCharCode(8206).repeat(4001);
      
      const vQuoted = getVerifiedQuoted(deviceConfig);
      await sock.sendMessage(chatId, { 
        text: l + readmore + r,
        contextInfo: getContextInfo(deviceConfig, m)
      }, { quoted: vQuoted as any });
      return;
    }

    if (["pastebin", "paste", "pb"].includes(command || "")) {
      let text = q;
      
      if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation) {
          text = m.message.extendedTextMessage.contextInfo.quotedMessage.conversation;
      } else if (m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text) {
          text = m.message.extendedTextMessage.contextInfo.quotedMessage.extendedTextMessage.text;
      }
      
      if (!text) {
        return reply(
          `📋 *ᴘᴀsᴛᴇʙɪɴ ᴜᴘʟᴏᴀᴅ*\n\n` +
          `Kirim teks untuk di-upload ke Pastebin.\n\n` +
          `*Cara pakai:*\n` +
          `• \`${prefix}pastebin <text>\`\n` +
          `• Reply teks dengan \`${prefix}pastebin\`\n\n` +
          `> Contoh: \`${prefix}pastebin console.log("Hello")\``
        );
      }
      
      await react('🕕');
      await reply(`🕕 *Sedang mengunggah ke Pastebin...*`);

      const api_dev_key = 'h9WMT2Mn9QW-qDhvUSc-KObqAYcjI0he';
      const api_paste_code = text.trim();
      const api_paste_name = `Paste dari ${m.pushName || 'User'} - ${new Date().toLocaleDateString('id-ID')}`;
      
      const params = new URLSearchParams();
      params.append('api_dev_key', api_dev_key);
      params.append('api_option', 'paste');
      params.append('api_paste_code', api_paste_code);
      params.append('api_paste_name', api_paste_name);
      params.append('api_paste_private', '1');
      
      try {
        const res = await axios.post('https://pastebin.com/api/api_post.php', params.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 15000
        });
        
        const url = res.data;
        
        if (typeof url !== 'string' || url.startsWith('Bad API request')) {
          await react('✖️');
          return reply(`❌ *ɢᴀɢᴀʟ*\n\n> ${url}`);
        }
        
        await react('✅');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
          text: `✅ *ᴘᴀsᴛᴇʙɪɴ ʙᴇʀʜᴀsɪʟ*\n\n` +
                `╭┈┈⬡「 📋 *ᴅᴇᴛᴀɪʟ* 」\n` +
                `┃ 📝 ᴊᴜᴅᴜʟ: *${api_paste_name}*\n` +
                `┃ 📊 ᴜᴋᴜʀᴀɴ: *${text.length} karakter*\n` +
                `┃ 🔗 ʟɪɴᴋ: ${url}\n` +
                `╰┈┈⬡\n\n` +
                `> Paste akan expired sesuai pengaturan default Pastebin.`,
          contextInfo: getContextInfo(deviceConfig, m, null, false, false)
        }, { quoted: vQuoted as any });
        
      } catch (e: any) {
        await react('☢️');
        reply(`❌ Terjadi kesalahan: ${e.message}`);
      }
      return;
    }

    if (["ssweb", "screenshot", "ss", "webss"].includes(command || "")) {
      let text = q;

      if (!text) {
        return reply(
          `📸 *sᴄʀᴇᴇɴsʜᴏᴛ ᴡᴇʙ*\n\n` +
          `> Screenshot halaman website\n\n` +
          `> *Contoh:*\n` +
          `> ${prefix}ssweb https://google.com\n` +
          `> ${prefix}${command} https://github.com --mobile`
        );
      }

      let mode = 'desktop';
      if (text.includes('--mobile') || text.includes('--hp')) {
        mode = 'mobile';
        text = text.replace(/--mobile|--hp/g, '').trim();
      }

      if (!text.startsWith('http')) {
        text = 'https://' + text;
      }

      await react('🕕');
      await reply(`🕕 *Sedang mengambil screenshot website...*`);

      try {
        const width = mode === 'mobile' ? 720 : 1920;
        const apiUrl = `https://image.thum.io/get/width/${width}/crop/1080/noanimate/${text}`;
        const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 30000 });
        const imageBuffer = Buffer.from(res.data);

        await react('✅');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
          image: imageBuffer,
          caption: `📸 *Screenshot Berhasil*\n> URL: ${text}\n> Mode: ${mode}`,
          contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: vQuoted as any });

      } catch (error: any) {
        await react('☢️');
        reply(`❌ Terjadi kesalahan: ${error.message}`);
      }
      return;
    }

    if (["recordweb", "recweb", "webrecord"].includes(command || "")) {
      let text = q?.trim();

      if (!text) {
        return reply(
          `📹 *ʀᴇᴄᴏʀᴅ ᴡᴇʙ*\n\n` +
          `> Rekam halaman website dalam bentuk video\n\n` +
          `> *Contoh:*\n` +
          `> ${prefix}recordweb google.com\n` +
          `> ${prefix}${command} https://github.com`
        );
      }

      if (!text.startsWith('http')) {
        text = 'https://' + text;
      }

      await react('🕕');
      await reply(`📹 *Sedang merekam website...*\n\n> URL: ${text}\n> Estimasi durasi: ~10-15 detik.\n_Harap tunggu sebentar..._`);

      try {
        const apiUrl = `https://api.cmnty.web.id/tools/record?url=${encodeURIComponent(text)}&device=iphone_15_pro&duration_ms=8000&scroll=true&dark_mode=true&wait_ms=1000`;
        const res = await axios.get(apiUrl, { responseType: 'arraybuffer', timeout: 60000 });
        const videoBuffer = Buffer.from(res.data);

        await react('✅');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
          video: videoBuffer,
          caption: `📹 *Record Web Berhasil* ✅\n\n> URL: ${text}\n> Device: iPhone 15 Pro\n> Durasi: 8s\n> Scroll: Aktif`,
          contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: vQuoted as any });

      } catch (error: any) {
        await react('❌');
        reply(`❌ Gagal merekam website: ${error.message}`);
      }
      return;
    }

    if (["ptv", "pvideo", "circlevideo"].includes(command || "")) {
      const typeMedia = Object.keys(m.message || {})[0];
      const isQuotedVideo = typeMedia === "extendedTextMessage" && m.message.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage;
      const isVideo = !!m.message?.videoMessage;

      if (!isVideo && !isQuotedVideo) {
        return reply(
            `⚠️ *ᴄᴀʀᴀ ᴘᴀᴋᴀɪ*\n\n` +
            `> Kirim *video* atau *balas video* lalu ketik:\n` +
            `> \`${prefix}ptv\``
        );
      }
      
      await react('🕕');
      await reply(`🕕 *ᴍᴇᴍʙᴜᴀᴛ ᴘᴛᴠ...*`);
      
      try {
        const target = isQuotedVideo ? m.message.extendedTextMessage.contextInfo.quotedMessage.videoMessage : m.message.videoMessage;
        const stream = await downloadContentFromMessage(target as any, "video");
        let buffer = Buffer.alloc(0);
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk]);
        }
        
        if (buffer.length === 0) throw new Error("Gagal mengunduh video");

        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
            video: buffer,
            mimetype: 'video/mp4',
            gifPlayback: true,
            ptv: true,
            contextInfo: getContextInfo(deviceConfig, m)
        }, { quoted: vQuoted as any });
        
        await react('✅');
      } catch (err: any) {
        await react('☢️');
        reply(`❌ Terjadi kesalahan: ${err.message}`);
      }
      return;
    }

    if (["menu", "help"].includes(command || "")) {
        await react("📜");
        let menu = `╭━━━〔 *CMNTY-BOT* 〕━━━┈\n`;
        menu += `┃ *ᴜꜱᴇʀ:* @${sender.split("@")[0]}\n`;
        menu += `┃ *ᴜᴘᴛɪᴍᴇ:* ${fmtUp((Date.now() - ((global as any).startTime || Date.now())) / 1000)}\n`;
        menu += `┃ *ᴅᴀᴛᴇ:* ${moment().tz("Asia/Jakarta").format("DD/MM/YYYY")}\n`;
        menu += `┃ *ᴊᴀᴅɪ ʙᴏᴛ:* jadi-bot.cmnty.web.id\n`;
        menu += `┃ *ʀᴇꜱᴛ ᴀᴘɪ:* api.cmnty.web.id\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *OWNER* 〕━┈\n`;
        menu += `┃ \`${prefix}ping\`\n`;
        menu += `┃ \`${prefix}addowner\`\n`;
        menu += `┃ \`${prefix}delowner\`\n`;
        menu += `┃ \`${prefix}listowner\`\n`;
        menu += `┃ \`${prefix}swgc\`\n`;
        menu += `┃ \`${prefix}autoread\`\n`;
        menu += `┃ \`${prefix}self\`\n`;
        menu += `┃ \`${prefix}public\`\n`;
        menu += `┃ \`${prefix}onlygc\`\n`;
        menu += `┃ \`${prefix}onlypc\`\n`;
        menu += `┃ \`${prefix}onlythisgrup\`\n`;
        menu += `┃ \`${prefix}ban\`\n`;
        menu += `┃ \`${prefix}unban\`\n`;
        menu += `┃ \`${prefix}autosholat\`\n`;
        menu += `┃ \`${prefix}listban\`\n`;
        menu += `┃ \`${prefix}buatgrup\`\n`;
        menu += `┃ \`${prefix}buatsaluran\`\n`;
        menu += `┃ \`${prefix}upch\`\n`;
        menu += `┃ \`${prefix}join\`\n`;
        menu += `┃ \`${prefix}leave\`\n`;
        menu += `┃ \`${prefix}pay\` / \`${prefix}payment\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *GROUP* 〕━┈\n`;
        menu += `┃ \`${prefix}ht\` / \`${prefix}h\`\n`;
        menu += `┃ \`${prefix}h2\`\n`;
        menu += `┃ \`${prefix}open\`\n`;
        menu += `┃ \`${prefix}close\`\n`;
        menu += `┃ \`${prefix}opentime\`\n`;
        menu += `┃ \`${prefix}delopentime\`\n`;
        menu += `┃ \`${prefix}closetime\`\n`;
        menu += `┃ \`${prefix}delclosetime\`\n`;
        menu += `┃ \`${prefix}cektime\`\n`;
        menu += `┃ \`${prefix}kick\`\n`;
        menu += `┃ \`${prefix}promote\`\n`;
        menu += `┃ \`${prefix}demote\`\n`;
        menu += `┃ \`${prefix}afk\`\n`;
        menu += `┃ \`${prefix}intro\`\n`;
        menu += `┃ \`${prefix}setintro\`\n`;
        menu += `┃ \`${prefix}resetintro\`\n`;
        menu += `┃ \`${prefix}rulesgrup\`\n`;
        menu += `┃ \`${prefix}setrulesgrup\`\n`;
        menu += `┃ \`${prefix}resetrulesgrup\`\n`;
        menu += `┃ \`${prefix}cekidgc\`\n`;
        menu += `┃ \`${prefix}cekonline\`\n`;
        menu += `┃ \`${prefix}linkgc\`\n`;
        menu += `┃ \`${prefix}resetlinkgc\`\n`;
        menu += `┃ \`${prefix}topchat\`\n`;
        menu += `┃ \`${prefix}mulaiabsen\`\n`;
        menu += `┃ \`${prefix}absen\`\n`;
        menu += `┃ \`${prefix}cekabsen\`\n`;
        menu += `┃ \`${prefix}hapusabsen\`\n`;
        menu += `┃ \`${prefix}welcome\`\n`;
        menu += `┃ \`${prefix}goodbye\`\n`;
        menu += `┃ \`${prefix}antilinkgc\`\n`;
        menu += `┃ \`${prefix}addantilink\`\n`;
        menu += `┃ \`${prefix}delantilink\`\n`;
        menu += `┃ \`${prefix}listantilink\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *DOWNLOAD* 〕━┈\n`;
        menu += `┃ \`${prefix}splay\`\n`;
        menu += `┃ \`${prefix}ytplay\`\n`;
        menu += `┃ \`${prefix}tt\`\n`;
        menu += `┃ \`${prefix}ttmp3\`\n`;
        menu += `┃ \`${prefix}ttplay\`\n`;
        menu += `┃ \`${prefix}ig\`\n`;
        menu += `┃ \`${prefix}fb\`\n`;
        menu += `┃ \`${prefix}ytmp3\`\n`;
        menu += `┃ \`${prefix}ytmp4\`\n`;
        menu += `┃ \`${prefix}spdl\`\n`;
        menu += `┃ \`${prefix}svdl\`\n`;
        menu += `┃ \`${prefix}videy\`\n`;
        menu += `┃ \`${prefix}terabox\`\n`;
        menu += `┃ \`${prefix}tdl\`\n`;
        menu += `┃ \`${prefix}ccdl\`\n`;
        menu += `┃ \`${prefix}mfdl\`\n`;
        menu += `┃ \`${prefix}githubdl\`\n`;
        menu += `┃ \`${prefix}ytplayvid\`\n`;
        menu += `┃ \`${prefix}playtiktok\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *STICKER* 〕━┈\n`;
        menu += `┃ \`${prefix}s\`\n`;
        menu += `┃ \`${prefix}brat\`\n`;
        menu += `┃ \`${prefix}bratvid\`\n`;
        menu += `┃ \`${prefix}bratvid2\`\n`;
        menu += `┃ \`${prefix}smeme\`\n`;
        menu += `┃ \`${prefix}bratvermeil\`\n`;
        menu += `┃ \`${prefix}bratanime\`\n`;
        menu += `┃ \`${prefix}bratbahlil\`\n`;
        menu += `┃ \`${prefix}bratgreen\`\n`;
        menu += `┃ \`${prefix}bratcewek\`\n`;
        menu += `┃ \`${prefix}bratsquidward\`\n`;
        menu += `┃ \`${prefix}stickerpack\`\n`;
        menu += `┃ \`${prefix}pinpack\`\n`;
        menu += `┃ \`${prefix}bratpatrick\`\n`;
        menu += `┃ \`${prefix}emojigif\`\n`;
        menu += `┃ \`${prefix}emojimix\`\n`;
        menu += `┃ \`${prefix}attp\`\n`;
        menu += `┃ \`${prefix}qc\`\n`;
        menu += `┃ \`${prefix}swm\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *LOGO MAKER* 〕━┈\n`;
        menu += `┃ \`${prefix}avengers\`\n`;
        menu += `┃ \`${prefix}bear\`\n`;
        menu += `┃ \`${prefix}blackpink\`\n`;
        menu += `┃ \`${prefix}cartoon-graffiti\`\n`;
        menu += `┃ \`${prefix}comic\`\n`;
        menu += `┃ \`${prefix}glitch\`\n`;
        menu += `┃ \`${prefix}mascot\`\n`;
        menu += `┃ \`${prefix}naruto\`\n`;
        menu += `┃ \`${prefix}pixel-glitch\`\n`;
        menu += `┃ \`${prefix}pornhub\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *RANDOM* 〕━┈\n`;
        menu += `┃ \`${prefix}anime\`\n`;
        menu += `┃ \`${prefix}blue-archive\`\n`;
        menu += `┃ \`${prefix}cecan-china\`\n`;
        menu += `┃ \`${prefix}cecan-indo\`\n`;
        menu += `┃ \`${prefix}cecan-japan\`\n`;
        menu += `┃ \`${prefix}cecan-korea\`\n`;
        menu += `┃ \`${prefix}cecan-thailand\`\n`;
        menu += `┃ \`${prefix}cecan-vietnam\`\n`;
        menu += `┃ \`${prefix}loli\`\n`;
        menu += `┃ \`${prefix}pap\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *CANVAS* 〕━┈\n`;
        menu += `┃ \`${prefix}iqc\`\n`;
        menu += `┃ \`${prefix}nulis\`\n`;
        menu += `┃ \`${prefix}fakeml\`\n`;
        menu += `┃ \`${prefix}fakeff\`\n`;
        menu += `┃ \`${prefix}fakebankjago\`\n`;
        menu += `┃ \`${prefix}fakedev\`\n`;
        menu += `┃ \`${prefix}fakestory\`\n`;
        menu += `┃ \`${prefix}fakecall\`\n`;
        menu += `┃ \`${prefix}fakedana\`\n`;
        menu += `┃ \`${prefix}math\`\n`;
        menu += `┃ \`${prefix}gura\`\n`;
        menu += `┃ \`${prefix}wafat\`\n`;
        menu += `┃ \`${prefix}pakustad\`\n`;
        menu += `┃ \`${prefix}fakektp\`\n`;
        menu += `┃ \`${prefix}susu\`\n`;
        menu += `┃ \`${prefix}susutaro\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *TOOLS* 〕━┈\n`;
        menu += `┃ \`${prefix}rvo\`\n`;
        menu += `┃ \`${prefix}translate\`\n`;
        menu += `┃ \`${prefix}hd\`\n`;
        menu += `┃ \`${prefix}hdvid\`\n`;
        menu += `┃ \`${prefix}remini\`\n`;
        menu += `┃ \`${prefix}blurface\`\n`;
        menu += `┃ \`${prefix}removebg\`\n`;
        menu += `┃ \`${prefix}deploy\`\n`;
        menu += `┃ \`${prefix}toimg\`\n`;
        menu += `┃ \`${prefix}tourl\`\n`;
        menu += `┃ \`${prefix}kodepos\`\n`;
        menu += `┃ \`${prefix}kalkulatormlbb\`\n`;
        menu += `┃ \`${prefix}trackip\`\n`;
        menu += `┃ \`${prefix}idch\`\n`;
        menu += `┃ \`${prefix}spamngl\`\n`;
        menu += `┃ \`${prefix}spamotp\`\n`;
        menu += `┃ \`${prefix}ipwho\`\n`;
        menu += `┃ \`${prefix}lookup\`\n`;
        menu += `┃ \`${prefix}qrcustom\`\n`;
        menu += `┃ \`${prefix}readmore\`\n`;
        menu += `┃ \`${prefix}pastebin\`\n`;
        menu += `┃ \`${prefix}ptv\`\n`;
        menu += `┃ \`${prefix}ssweb\`\n`;
        menu += `┃ \`${prefix}recordweb\`\n`;
        menu += `┃ \`${prefix}web2zip\`\n`;
        menu += `┃ \`${prefix}webtoapk\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *STALKER* 〕━┈\n`;
        menu += `┃ \`${prefix}igstalk\`\n`;
        menu += `┃ \`${prefix}stalkml\`\n`;
        menu += `┃ \`${prefix}stalkff\`\n`;
        menu += `┃ \`${prefix}roblox\`\n`;
        menu += `┃ \`${prefix}genshin\`\n`;
        menu += `┃ \`${prefix}wastalk\`\n`;
        menu += `┃ \`${prefix}ttstalk\`\n`;
        menu += `┃ \`${prefix}gitstalk\`\n`;
        menu += `┃ \`${prefix}pinstalk\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *AI* 〕━┈\n`;
        menu += `┃ \`${prefix}to3d\`\n`;
        menu += `┃ \`${prefix}tochibi\`\n`;
        menu += `┃ \`${prefix}toblack\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *ISLAMIC* 〕━┈\n`;
        menu += `┃ \`${prefix}quran\`\n`;
        menu += `┃ \`${prefix}murrotal\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *NSFW* 〕━┈\n`;
        menu += `┃ \`${prefix}hentai\`\n`;
        menu += `┃ \`${prefix}kasedaiki\`\n`;
        menu += `┃ \`${prefix}gangbang\`\n`;
        menu += `┃ \`${prefix}dongart\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *FUN* 〕━┈\n`;
        menu += `┃ \`${prefix}akankah\`\n`;
        menu += `┃ \`${prefix}apakah\`\n`;
        menu += `┃ \`${prefix}bagaimana\`\n`;
        menu += `┃ \`${prefix}berapa\`\n`;
        menu += `┃ \`${prefix}bisakah\`\n`;
        menu += `┃ \`${prefix}cekkhodam\`\n`;
        menu += `┃ \`${prefix}cekpacar\`\n`;
        menu += `┃ \`${prefix}coba\`\n`;
        menu += `┃ \`${prefix}confess\`\n`;
        menu += `┃ \`${prefix}dimana\`\n`;
        menu += `┃ \`${prefix}gay\`\n`;
        menu += `┃ \`${prefix}haruskah\`\n`;
        menu += `┃ \`${prefix}jodoh\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *GAME* 〕━┈\n`;
        menu += `┃ \`${prefix}tebakbendera\`\n`;
        menu += `┃ \`${prefix}tebakgambar\`\n`;
        menu += `┃ \`${prefix}lengkapikalimat\`\n`;
        menu += `┃ \`${prefix}tebakkata\`\n`;
        menu += `┃ \`${prefix}tekateki\`\n`;
        menu += `┃ \`${prefix}asahotak\`\n`;
        menu += `┃ \`${prefix}tebaklagu\`\n`;
        menu += `┃ \`${prefix}tebakheroml\`\n`;
        menu += `┃ \`${prefix}tebaklogo\`\n`;
        menu += `┃ \`${prefix}tebakgame\`\n`;
        menu += `┃ \`${prefix}tebakkalimat\`\n`;
        menu += `┃ \`${prefix}cerdascermat\`\n`;
        menu += `┃ \`${prefix}susunkata\`\n`;
        menu += `┃ \`${prefix}siapakahaku\`\n`;
        menu += `┃ \`${prefix}caklontong\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *OTHER* 〕━┈\n`;
        menu += `┃ \`${prefix}gempa\`\n`;
        menu += `┃ \`${prefix}cuaca\`\n`;
        menu += `┃ \`${prefix}npm\`\n`;
        menu += `┃ \`${prefix}pins\`\n`;
        menu += `┃ \`${prefix}buildml\`\n`;
        menu += `┃ \`${prefix}infotourney\`\n`;
        menu += `┃ \`${prefix}bluearchive-char\`\n`;
        menu += `┃ \`${prefix}berita\`\n`;
        menu += `┃ \`${prefix}cnn\`\n`;
        menu += `┃ \`${prefix}cnbc\`\n`;
        menu += `┃ \`${prefix}antara\`\n`;
        menu += `┃ \`${prefix}sindonews\`\n`;
        menu += `┃ \`${prefix}jadwaltv\`\n`;
        menu += `┃ \`${prefix}jadwalbola\`\n`;
        menu += `┃ \`${prefix}lirik\`\n`;
        menu += `╰━━━━━━━━━━━━┈.✦ ݁˖\n`;
        menu += `╭━〔 *SUPORT DEVELOPER* 〕━┈\n`;
        menu += `┃ \`${prefix}qris\`\n`;
        menu += `┃ \`${prefix}saweria\`\n`;
        menu += `┃ \`${prefix}tako\`\n`;
        menu += `╰━━━━━━━━━━━━┈`;

        await sock.sendMessage(chatId, {
          image: { url: config.thumbnail },
          caption: menu,
          mentions: [sender],
          contextInfo: { ...getContextInfo(deviceConfig, m, null, true, false, false, "https://bot.cmnty.qzz.io"), forwardedNewsletterMessageInfo },
        }, { quoted: getVerifiedQuoted(deviceConfig) as any });
        return;
      }

      if (["cekonline", "checkonline", "online", "siapayangonline", "whosonline"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        await react('🔍');
        
        try {
            const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
            const participants = groupMetadata?.participants || [];
            
            if (participants.length === 0) {
                await react('❌');
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Tidak bisa mendapatkan data member grup`);
            }
            
            await reply(`🔍 *ᴍᴇɴᴄᴀʀɪ ᴍᴇᴍʙᴇʀ ᴏɴʟɪɴᴇ...*\n\n> Menunggu response dari ${participants.length} member\n> Estimasi: 5-10 detik`);
            
            const presences: { [jid: string]: string } = {};
            
            const presenceHandler = (update: any) => {
                if (update.id === chatId && update.presences) {
                    for (const [jid, presence] of Object.entries(update.presences) as any) {
                        if (presence.lastKnownPresence === 'available' || 
                            presence.lastKnownPresence === 'composing' || 
                            presence.lastKnownPresence === 'recording') {
                            presences[jid] = presence.lastKnownPresence;
                        }
                    }
                }
            };
            
            sock.ev.on('presence.update', presenceHandler);
            
            const batchSize = 10;
            for (let i = 0; i < participants.length; i += batchSize) {
                const batch = participants.slice(i, i + batchSize);
                await Promise.all(batch.map(p => 
                    sock.presenceSubscribe(p.id).catch(() => {})
                ));
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            sock.ev.off('presence.update', presenceHandler);
            
            const onlineMembers = Object.keys(presences);
            
            let text = `📊 *ᴄᴇᴋ ᴏɴʟɪɴᴇ*\n\n`;
            text += `╭┈┈⬡「 📋 *ɪɴꜰᴏ ɢʀᴜᴘ* 」\n`;
            text += `┃ 👥 ɴᴀᴍᴀ: *${groupMetadata?.subject}*\n`;
            text += `┃ 👤 ᴛᴏᴛᴀʟ: \`${participants.length}\` member\n`;
            text += `┃ 🟢 ᴏɴʟɪɴᴇ: \`${onlineMembers.length}\` member\n`;
            text += `╰┈┈⬡\n\n`;
            
            if (onlineMembers.length === 0) {
                text += `> _Tidak ada member yang terdeteksi online_\n`;
                text += `> _Pastikan member telah membuka WA_\n`;
            } else {
                text += `╭┈┈⬡「 🟢 *ᴍᴇᴍʙᴇʀ ᴏɴʟɪɴᴇ* 」\n`;
                
                let count = 0;
                for (const jid of onlineMembers) {
                    if (count >= 50) {
                        text += `┃ ... dan ${onlineMembers.length - 50} member lainnya\n`;
                        break;
                    }
                    const number = jid.split('@')[0];
                    const participant = participants.find((p: any) => p.id === jid);
                    const isAdmin = participant?.admin === 'admin' || participant?.admin === 'superadmin';
                    const adminBadge = isAdmin ? ' 👑' : '';
                    
                    let statusIcon = '🟢';
                    if (presences[jid] === 'composing') statusIcon = '⌨️';
                    if (presences[jid] === 'recording') statusIcon = '🎤';
                    
                    text += `┃ ${statusIcon} @${number}${adminBadge}\n`;
                    count++;
                }
                
                text += `╰┈┈⬡\n\n`;
                text += `> 🟢 Online | ⌨️ Mengetik | 🎤 Rekam Audio\n`;
            }
            
            await react('✅');
            await sock.sendMessage(chatId, { text, contextInfo: { mentionedJid: onlineMembers, ...getContextInfo(deviceConfig, m, null, true, true).contextInfo } }, { quoted: getVerifiedQuoted(deviceConfig) as any });
            
        } catch (error: any) {
            await react('☢️');
            reply(`❌ *ɢᴀɢᴀʟ*\n\n> ${error.message}`);
        }
        return;
      }

      if (["topchat", "chatstat", "chatstats", "totalchat", "leaderboard"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        await react('📊');
        
        const db = getDatabase();
        const group = (await db.getGroup(chatId)) || {};
        const chatStats = group.chatStats || {};
        const sorted = Object.entries(chatStats)
            .map(([jid, data]: [string, any]) => ({
                jid,
                count: data.count || 0,
                lastChat: data.lastChat || 0
            }))
            .sort((a, b) => b.count - a.count);
            
        if (sorted.length === 0) {
            await react('❌');
            return reply(
                `📊 *ᴄʜᴀᴛ sᴛᴀᴛɪsᴛɪᴄs*\n\n` +
                `> Belum ada data chat di grup ini.\n` +
                `> Data akan tercatat otomatis setelah member aktif chat.`
            );
        }
        
        // Show Top 50 maximum to avoid message too long
        const limitCount = Math.min(sorted.length, 50);
        
        let txt = `📊 *TOTAL CHAT*\nBerikut ini adalah jumlah pesan yang dikirim oleh member di grup ini:\n\n`;
        for (let i = 0; i < limitCount; i++) {
            const { jid, count } = sorted[i];
            const name = jid.split('@')[0];
            txt += `${i + 1}. @${name} - 💬 *${count.toLocaleString('id-ID')}* pesan\n`;
        }
        
        if (sorted.length > limitCount) {
            txt += `\n...dan ${sorted.length - limitCount} member lainnya.`;
        }
        
        txt += `\n\n*Total Pesan Keseluruhan: ${sorted.reduce((a, b) => a + b.count, 0).toLocaleString('id-ID')}*`;
        
        const mentions = sorted.slice(0, limitCount).map(u => u.jid);
        
        await react('✅');
        const vQuoted = getVerifiedQuoted(deviceConfig);
        await sock.sendMessage(chatId, {
            text: txt,
            mentions: mentions,
            contextInfo: getContextInfo(deviceConfig, m, null, true, true)
        }, { quoted: vQuoted as any });
        
        return;
      }

      if (["linkgc", "linkgrup", "getlink", "gclink"].includes(command || "")) {
        if (!isGroup) return reply("❌ Fitur ini hanya dapat digunakan di dalam grup!");
        
        await react('🕕');
        try {
            const groupMetadata = await sock.groupMetadata(chatId).catch(() => null);
            const participants = groupMetadata?.participants || [];
            
            const isAdmin = participants.find((p: any) => p.id === sender)?.admin;
            const isBotAdmin = participants.find((p: any) => p.id === (sock.user?.id?.split(':')[0] + '@s.whatsapp.net'))?.admin;
            
            if (!isAdmin && !isOwner) {
                await react('❌');
                return reply("❌ Fitur ini khusus Admin grup!");
            }
            if (!isBotAdmin) {
                await react('❌');
                return reply("❌ Bot harus menjadi admin untuk mendapatkan link grup!");
            }
            
            const code = await sock.groupInviteCode(chatId);
            const urlGrup = `https://chat.whatsapp.com/${code}`;
            await reply(`Link grup grup ini\n${urlGrup}`);
            
            await react('✅');
        } catch (error: any) {
            console.error("[LinkGC Error]:", error.message);
            await react('☢️');
            reply(`❌ *ɢᴀɢᴀʟ*\n\n> ${error.message}`);
        }
        return;
      }

      if (["cekidgc", "idgc", "idgrup", "groupid", "infogc", "groupinfo"].includes(command || "")) {
        await react('⏳');

        try {
            const input = q;
            let groupJid: string | null = null;
            let groupMeta: any = null;

            if (input && input.includes('chat.whatsapp.com/')) {
                const inviteCode = input.split('chat.whatsapp.com/')[1]?.split(/[\s?]/)[0];

                if (!inviteCode) {
                    await react('✘');
                    return reply(`── .✦ ──\n\n> Link grup tidak valid .☘︎ ݁˖`);
                }

                try {
                    groupMeta = await sock.groupGetInviteInfo(inviteCode);
                    groupJid = groupMeta?.id;
                } catch {
                    await react('✘');
                    return reply(`── .✦ ──\n\n> Link grup tidak valid atau sudah expired .☘︎ ݁˖`);
                }
            } else if (input && input.endsWith('@g.us')) {
                groupJid = input;
                try {
                    groupMeta = await sock.groupMetadata(groupJid);
                } catch {
                    await react('✘');
                    return reply(`── .✦ ──\n\n> Tidak bisa mengakses grup tersebut .☘︎ ݁˖`);
                }
            } else if (isGroup) {
                groupJid = chatId;
                groupMeta = await sock.groupMetadata(groupJid);
            } else {
                return reply(
                    `── .✦ 𝗖𝗘𝗞 𝗜𝗗 𝗚𝗥𝗨𝗣 ✦. ── 𝜗ৎ\n\n` +
                    `> Gunakan di grup atau masukkan link grup\n\n` +
                    `> \`${prefix}cekidgc\` — di dalam grup\n` +
                    `> \`${prefix}cekidgc https://chat.whatsapp.com/xxx\``
                );
            }

            if (!groupMeta || !groupJid) {
                await react('✘');
                return reply(`── .✦ ──\n\n> Tidak dapat menemukan info grup .☘︎ ݁˖`);
            }

            const formatDate = (timestamp: any) => {
                if (!timestamp) return '—';
                const d = new Date(typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp);
                const pad = (n: number) => String(n).padStart(2, '0');
                if (isNaN(d.getTime())) return '—';
                return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
            };

            const groupName = groupMeta.subject || 'Unknown';
            const participants = groupMeta.participants || [];
            const memberCount = participants.length || groupMeta.size || 0;
            const admins = participants.filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin');
            const adminCount = admins.length;
            const groupOwner = groupMeta.owner || groupMeta.subjectOwner || '—';
            const createdAt = formatDate(groupMeta.creation);
            const groupDesc = groupMeta.desc || '—';
            const descPreview = groupDesc.length > 120 ? groupDesc.substring(0, 120) + '...' : groupDesc;
            const isRestrict = groupMeta.restrict ? 'Admin Only' : 'Semua Member';
            const isAnnounce = groupMeta.announce ? 'Aktif' : 'Nonaktif';
            const isCommunity = groupMeta.isCommunity ? '✓ Ya' : '✘ Tidak';
            const joinMode = groupMeta.joinApprovalMode ? 'Perlu Approval' : 'Bebas';

            let ppBuffer: Buffer | null = null;
            try {
                const ppUrl = await sock.profilePictureUrl(groupJid, 'image');
                if (ppUrl) {
                    const res = await axios.get(ppUrl, { responseType: 'arraybuffer', timeout: 10000 });
                    ppBuffer = Buffer.from(res.data);
                }
            } catch {}

            const saluranId = config.channel.id;
            const saluranName = config.channel.name;

            const infoText = 
                `── .✦ 𝗚𝗥𝗢𝗨𝗣 𝗜𝗡𝗙𝗢 ✦. ── 𝜗ৎ\n\n` +
                `╭─〔 ${groupName} 〕───⬣\n` +
                `│  ✦ ɴᴀᴍᴀ        : *${groupName}*\n` +
                `│  ✦ ɪᴅ             : \`${groupJid}\`\n` +
                `│  ✦ ᴍᴇᴍʙᴇʀ     : *${memberCount}*\n` +
                `│  ✦ ᴀᴅᴍɪɴ        : *${adminCount}*\n` +
                `│  ✦ ᴏᴡɴᴇʀ       : @${groupOwner.replace(/@.+/g, '')}\n` +
                `│  ✦ ᴅɪʙᴜᴀᴛ       : *${createdAt}*\n` +
                `│  ✦ ᴋᴏᴍᴜɴɪᴛᴀs : *${isCommunity}*\n` +
                `│  ✦ ᴇᴅɪᴛ ɪɴꜰᴏ   : *${isRestrict}*\n` +
                `│  ✦ ᴀɴɴᴏᴜɴᴄᴇ : *${isAnnounce}*\n` +
                `│  ✦ ᴊᴏɪɴ ᴍᴏᴅᴇ  : *${joinMode}*\n` +
                `│  ✦ ᴅᴇsᴋʀɪᴘsɪ  : ${descPreview}\n` +
                `╰──────────────⬣\n\n` +
                `.☘︎ ݁˖ © ${config.bot.name}`;

            const buttons = [
                {
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                        display_text: '✦ Copy ID Grup',
                        copy_code: groupJid
                    })
                }
            ];

            const ctxInfo = {
                mentionedJid: [sender, groupOwner !== '—' ? groupOwner : sender],
                forwardingScore: 9999,
                isForwarded: true,
                forwardedNewsletterMessageInfo: { newsletterJid: saluranId, newsletterName: saluranName, serverMessageId: 127 }
            };

            const defaultVQuoted = getVerifiedQuoted(deviceConfig);

            if (ppBuffer) {
                let headerMedia = null;
                try {
                    const sharp = (await import('sharp')).default;
                    const resized = await sharp(ppBuffer).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
                    headerMedia = await prepareWAMessageMedia({ image: resized }, { upload: sock.waUploadToServer });
                } catch (e) {
                    console.error('Sharp resize error', e);
                }

                const msg = generateWAMessageFromContent(chatId, {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                                body: proto.Message.InteractiveMessage.Body.fromObject({ text: infoText }),
                                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: `© ${config.bot.name}` }),
                                header: proto.Message.InteractiveMessage.Header.fromObject({
                                    hasMediaAttachment: !!headerMedia,
                                    ...(headerMedia || {})
                                }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons }),
                                contextInfo: ctxInfo
                            })
                        }
                    }
                }, { userJid: sock.user?.id, quoted: defaultVQuoted as any });

                await sock.relayMessage(chatId, msg.message!, { messageId: msg.key.id! });
            } else {
                const msg = generateWAMessageFromContent(chatId, {
                    viewOnceMessage: {
                        message: {
                            messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                            interactiveMessage: proto.Message.InteractiveMessage.fromObject({
                                body: proto.Message.InteractiveMessage.Body.fromObject({ text: infoText }),
                                footer: proto.Message.InteractiveMessage.Footer.fromObject({ text: `© ${config.bot.name}` }),
                                nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({ buttons }),
                                contextInfo: ctxInfo
                            })
                        }
                    }
                }, { userJid: sock.user?.id, quoted: defaultVQuoted as any });

                await sock.relayMessage(chatId, msg.message!, { messageId: msg.key.id! });
            }

            await react('✓');
        } catch (error: any) {
            console.error('[CekIdGc] Error:', error.message);
            await react('✘');
            reply(`❌ *ɢᴀɢᴀʟ*\n\n> Terjadi kesalahan saat mengambil informasi grup.`);
        }
        return;
      }

      if (["idch", "cekidch", "channelid"].includes(command || "")) {
        if (!q) return reply(`📺 *Cᴇᴋ ID Cʜᴀɴɴᴇʟ*\n\n> Masukkan link undangan (Invite Link) channel WhatsApp\n\n\`Contoh: ${prefix}idch https://whatsapp.com/channel/xxxxx\``);
        if (!q.includes('https://whatsapp.com/channel/')) return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Link channel tidak valid`);

        await react("📺");
        try {
            const inviteCode = q.split('https://whatsapp.com/channel/')[1]?.split(/[\s?]/)[0];
            if (!inviteCode) {
                await react("❌");
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Tidak dapat mengekstrak kode invite`);
            }

            // @ts-ignore
            const metadata = await sock.newsletterMetadata('invite', inviteCode);
            if (!metadata?.id) {
                await react("❌");
                return reply(`❌ *ɢᴀɢᴀʟ*\n\n> Channel tidak ditemukan`);
            }

            const subscribers = metadata.subscribers || (metadata as any).subscribers_count || 0;

            const infoText = `📺 *ᴄʜᴀɴɴᴇʟ ɪɴꜰᴏ*\n\n` +
                `╭━〔 📋 *ᴅᴇᴛᴀɪʟ* 〕━┈\n` +
                `┃ 🆔 ɪᴅ: \`${metadata.id}\`\n` +
                `┃ 📝 ɴᴀᴍᴀ: \`${metadata.name || 'Unknown'}\`\n` +
                `┃ 👥 sᴜʙsᴄʀɪʙᴇʀ: \`${subscribers}\`\n` +
                `╰━━━━━━━━━━━━━┈\n\n` +
                `> Klik link di bawah untuk menyalin ID`;

            await sock.sendMessage(m.key.remoteJid!, { 
                text: infoText,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    externalAdReply: {
                        title: metadata.name || "Channel Info",
                        body: `ID: ${metadata.id}`,
                        thumbnailUrl: config.thumbnail,
                        mediaType: 1,
                        renderLargerThumbnail: true
                    }
                }
            }, { quoted: m });
            await reply(`📋 *ᴄᴏᴘʏ ɪᴅ:*\n\`${metadata.id}\``);
            await react("✅");
        } catch (e: any) {
            console.error("[IDCH Error]:", e.message);
            await react("❌");
            reply(`❌ *ɢᴀɢᴀʟ*\n\n> Terjadi kesalahan saat mengambil metadata. Pastikan link benar.`);
        }
        return;
    }
  }
} catch (err: any) {
  if (!err.message.includes("Connection Closed")) {
    console.error("[MSG_HANDLER_ERROR]", err.message);
  }
}
}

let userProfileCache: {
  id: string;
  name: string;
  profilePic: string | null;
  lastFetch?: number;
} | null = null;

process.on("uncaughtException", (err) => {
  const errorMsg = err instanceof Error ? err.message : String(err);
  if (errorMsg.includes("Failed to decrypt") || errorMsg.includes("MessageCounterError") || errorMsg.includes("Session error") || errorMsg.includes("Connection Closed")) return;
  console.error("Uncaught Exception:", err);
  addSystemLog("main_session", `CRITICAL System Error: ${err.message}`, "error");
});

process.on("unhandledRejection", (reason, promise) => {
  const errorMsg = reason instanceof Error ? reason.message : String(reason);
  if (errorMsg.includes("Failed to decrypt") || errorMsg.includes("MessageCounterError") || errorMsg.includes("Session error") || errorMsg.includes("Connection Closed")) return;
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  addSystemLog("main_session", `Unhandled Rejection: ${errorMsg}`, "warn");
});

const RECONNECT_INTERVAL = 5000;

// Global Variables
if (!(global as any).absensi) (global as any).absensi = {};
if (!(global as any).afk) (global as any).afk = {};
if (!(global as any).tebakbendera) (global as any).tebakbendera = {};
if (!(global as any).tebakgambar) (global as any).tebakgambar = {};
if (!(global as any).lengkapikalimat) (global as any).lengkapikalimat = {};
if (!(global as any).tebakkata) (global as any).tebakkata = {};
if (!(global as any).tekateki) (global as any).tekateki = {};
if (!(global as any).asahotak) (global as any).asahotak = {};
if (!(global as any).tebakheroml) (global as any).tebakheroml = {};
if (!(global as any).tebaklogo) (global as any).tebaklogo = {};
if (!(global as any).tebakgame) (global as any).tebakgame = {};
if (!(global as any).tebaklagu) (global as any).tebaklagu = {};
if (!(global as any).tebakkalimat) (global as any).tebakkalimat = {};
if (!(global as any).cerdascermat) (global as any).cerdascermat = {};
if (!(global as any).susunkata) (global as any).susunkata = {};
if (!(global as any).siapakahaku) (global as any).siapakahaku = {};
if (!(global as any).caklontong) (global as any).caklontong = {};
if (!(global as any).confessData) (global as any).confessData = new Map();

async function startServer() {
  try {
    (global as any).startTime = Date.now();
    const app = express();
    const PORT = Number(process.env.PORT) || 3000;
    app.use(express.json());

    // --- Active Visitor Tracking ---
    const activeVisitors = new Map<string, number>();
    const VISITOR_TIMEOUT = 5 * 60 * 1000; // 5 minutes

    app.use((req, res, next) => {
      // Exclude API and assets from tracking if desired, or just track all requests
      if (!req.path.startsWith('/api/') && !req.path.startsWith('/assets/')) {
        const forwarded = req.headers['x-forwarded-for'];
        const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || 'unknown';
        activeVisitors.set(ip, Date.now());
      }
      next();
    });

    // Helper to get active visitor count
    const getActiveVisitorCount = () => {
      const now = Date.now();
      let count = 0;
      for (const [ip, lastSeen] of activeVisitors.entries()) {
        if (now - lastSeen > VISITOR_TIMEOUT) {
          activeVisitors.delete(ip);
        } else {
          count++;
        }
      }
      return count;
    };
    // ---------------------------------

    // Helper to get deviceId from request
    const getDeviceId = (req: any) => (req.query.deviceId || req.body.deviceId || "main_session") as string;

    // API routes
    app.get("/api/status", async (req, res) => {
      try {
        const deviceId = getDeviceId(req);
        const instance = getInstance(deviceId);
        const memoryMB = Math.round(process.memoryUsage().rss / 1024 / 1024);
        let user = null;

        const credsFile = path.join(sessionsDir, deviceId, "creds.json");
        let sessionIsAuthenticated = false;
        let nameFromCreds = "";
        if (fs.existsSync(credsFile)) {
          try {
            const creds = JSON.parse(fs.readFileSync(credsFile, "utf-8"));
            if (creds.me && (creds.me.id || creds.me.jid)) {
              sessionIsAuthenticated = true;
              nameFromCreds = creds.me.pushName || creds.me.verifiedName || creds.me.name || creds.me.notify || "";
              if (nameFromCreds === 'N') nameFromCreds = creds.me.pushName || "";
            }
          } catch (e) {}
        }

        if (instance.activeSocket?.user || sessionIsAuthenticated) {
          const fullId = instance.activeSocket?.user?.id || (sessionIsAuthenticated ? "session@s.whatsapp.net" : "");
          const credsMe = instance.activeSocket?.authState?.creds?.me as any;
          const socketUserName = instance.activeSocket?.user?.name;
          const cleanNumber = fullId.split("@")[0].split(":")[0];

          const now = Date.now();
          const cacheNeedsUpdate = !instance.userProfileCache || (cleanNumber !== "session" && instance.userProfileCache.id !== cleanNumber);
          const isGenericInCache = instance.userProfileCache && (!instance.userProfileCache.name || 
                                   instance.userProfileCache.name === "unknown");

          const isGenericName = (name: string) => 
            !name || 
            name === "unknown";

          if (cacheNeedsUpdate || (isGenericInCache && (nameFromCreds || credsMe?.pushName || credsMe?.verifiedName || credsMe?.name || socketUserName))) {
            let finalName = instance.userProfileCache?.name || "unknown";
            
            if (isGenericName(finalName)) {
              finalName = nameFromCreds || credsMe?.pushName || credsMe?.verifiedName || credsMe?.name || socketUserName || "unknown";
            }
            
            if (finalName === 'N') finalName = credsMe?.pushName || socketUserName || "unknown";
            
            instance.userProfileCache = {
              id: cleanNumber,
              name: finalName,
              profilePic: instance.userProfileCache?.profilePic || null,
              lastFetch: 0,
            };
          }

          const shouldTryFetch = !instance.userProfileCache?.profilePic && (!instance.userProfileCache?.lastFetch || now - (instance.userProfileCache?.lastFetch || 0) > 3600000);

          if (shouldTryFetch && instance.activeSocket && instance.connectionStatus === "connected") {
            const cleanJid = instance.userProfileCache?.id === "session" ? "" : instance.userProfileCache?.id + "@s.whatsapp.net";
            if (cleanJid) {
              if (instance.userProfileCache) instance.userProfileCache.lastFetch = now;
              (async () => {
                try {
                  if (instance.activeSocket && instance.connectionStatus === "connected") {
                    const ppUrl = await instance.activeSocket.profilePictureUrl(cleanJid, "image").catch(() => null);
                    if (instance.userProfileCache) instance.userProfileCache.profilePic = ppUrl;
                  }
                } catch (e) {}
              })();
            }
          }
          user = instance.userProfileCache;
        }

        res.json({
          connected: instance.connectionStatus === "connected",
          status: instance.connectionStatus,
          sessionExists: sessionIsAuthenticated,
          memoryUsageMB: memoryMB,
          uptimeSeconds: instance.connectedTime > 0 ? Math.floor((Date.now() - instance.connectedTime) / 1000) : 0,
          serverUptimeSeconds: process.uptime(),
          user: user,
          metrics: { messagesProcessed: instance.messagesProcessed, activeGroupsCount: instance.activeGroupsCount },
        });
      } catch (error) {
        console.error("Error in /api/status:", error);
        res.status(500).json({ error: "Internal Server Error" });
      }
    });

    app.get("/api/health", (req, res) => {
      res.json({ status: "online", uptime: process.uptime() });
    });

    app.post("/api/reconnect", async (req, res) => {
      const deviceId = getDeviceId(req);
      addSystemLog(deviceId, "Manual reconnection requested", "info");
      try {
        await connectToWhatsApp(deviceId);
        res.json({ success: true });
      } catch (err) {
        addSystemLog(deviceId, "Manual reconnection failed", "error");
        res.status(500).json({ error: "Failed to reconnect" });
      }
    });

    app.get("/api/config", (req, res) => {
      try {
        const deviceId = getDeviceId(req);
        const instance = getInstance(deviceId);
        const deviceConfig = instance.config;

        const globalConfPath = path.join(process.cwd(), 'config.json');
        let globalConf: any = {};
        if (fs.existsSync(globalConfPath)) {
            globalConf = JSON.parse(fs.readFileSync(globalConfPath, 'utf-8'));
        }

        let ownerNumber = "";
        if (deviceConfig.owner && deviceConfig.owner.length > 0) {
          ownerNumber = deviceConfig.owner[0].split("@")[0];
        }

        res.json({
          botName: globalConf.botName || "CMNTY-BOT",
          ownerNumber,
          stickerPack: deviceConfig.stickerPack || "Cmnty Universe",
          stickerAuthor: deviceConfig.stickerAuthor || "jadi-bot.cmnty.web.id",
          botMode: deviceConfig.botMode || "public",
          onlyGc: deviceConfig.onlyGc || false,
          onlyPc: deviceConfig.onlyPc || false,
          bot: { name: globalConf.botName || "CMNTY-BOT" },
          vercelToken: deviceConfig.vercelToken || "",
          channelId: globalConf.channelId || "120363426467190619@newsletter",
          channelName: globalConf.channelName || "CMNTY-BOT",
          channelLink: globalConf.channelLink || "https://whatsapp.com/channel/0029VbCox0f17Emr10Bdlj0V",
          autoFollowChannelId: globalConf.autoFollowChannelId || "120363426467190619@newsletter",
          autoFollowChannelId2: globalConf.autoFollowChannelId2 || "",
          autoFollowChannelId3: globalConf.autoFollowChannelId3 || "120363426953159258@newsletter",
          autoJoinGroupId: globalConf.autoJoinGroupId || "",
          thumbnailUrl: globalConf.thumbnailUrl || "https://c.termai.cc/i151/4aSA.png",
          takoUsername: globalConf.takoUsername || "ojicmnty",
          saweriaUserId: globalConf.saweriaUserId || "73182004-b86b-4c16-ace4-bc23c3d8e9aa",
          nevapediaApiKey: deviceConfig.nevapediaApiKey !== undefined ? deviceConfig.nevapediaApiKey : (globalConf.nevapediaApiKey || ""),
          googleAnalyticsId: globalConf.googleAnalyticsId || ""
        });
      } catch (e) {
        res.status(500).json({ error: "Failed to read config" });
      }
    });

    app.post("/api/config", (req, res) => {
      const deviceId = getDeviceId(req);
      const instance = getInstance(deviceId);
      addSystemLog(deviceId, "Configuration updated via API", "info");
      try {
        const configPath = path.join(sessionsDir, deviceId, "config.json");
        const body = { ...req.body };
        delete body.deviceId; // clean body

        if (body.ownerNumber !== undefined) {
          const numbers = body.ownerNumber.split(',').map((n: string) => n.replace(/[^0-9]/g, "").trim()).filter((n: string) => n.length > 0);
          body.owner = numbers.map((n: string) => `${n}@s.whatsapp.net`);
        }

        
        const finalConfig = { ...instance.config, ...body };
        instance.config = finalConfig;
        fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));
        
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: "Failed to update config" });
      }
    });

    app.post("/api/pair", async (req, res) => {
      const deviceId = getDeviceId(req);
      const { phone, method } = req.body;

      // Pairing request
      addSystemLog(deviceId, `Pairing requested (method: ${method || "pairing-code"})`, "info");

      if (method === "qr") {
        connectToWhatsApp(deviceId, undefined, res, method);
        if (res && !res.headersSent) {
          res.json({ message: "QR Code generation started, please wait" });
        }
        return;
      }

      if (!phone) return res.status(400).json({ error: "Phone number required" });
      connectToWhatsApp(deviceId, phone.replace(/[^0-9]/g, ""), res, method);
    });

    app.post("/api/logout", async (req, res) => {
      const deviceId = getDeviceId(req);
      const instance = getInstance(deviceId);
      addSystemLog(deviceId, "Manual logout requested", "warn");
      if (instance.activeSocket) {
        try {
          await Promise.race([
            instance.activeSocket.logout("user_requested"),
            new Promise((resolve) => setTimeout(resolve, 8000)),
          ]);
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (e) {
          try { instance.activeSocket.end(new Error("Closed")); } catch (e2) {}
        }
        instance.activeSocket = null;
      }
      const sessionPath = path.join(sessionsDir, deviceId);
      if (fs.existsSync(sessionPath)) {
        try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (e) {}
      }
      instance.connectionStatus = "disconnected";
      instance.activeQrCode = null;
      instances.delete(deviceId);
      res.json({ success: true });
    });

    app.get("/api/admin/my-ip", (req, res) => {
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
      res.json({ ip: clientIp });
    });

    app.get("/api/admin/check-auth", (req, res) => {
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
      
      const confPath = path.join(process.cwd(), 'config.json');
      let allowedIPs: string[] = [];
      if (fs.existsSync(confPath)) {
          const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
          allowedIPs = conf.allowedIPs || [];
      }

      // Bootstrap: if no IPs allowed, allow the first one and register it
      if (allowedIPs.length === 0 && clientIp) {
        const newConf = fs.existsSync(confPath) ? JSON.parse(fs.readFileSync(confPath, 'utf-8')) : {};
        newConf.allowedIPs = [clientIp];
        fs.writeFileSync(confPath, JSON.stringify(newConf, null, 2));
        return res.json({ success: true, viaIp: true, bootstrapped: true });
      }

      const isWhitelistedIp = allowedIPs.includes(clientIp || '');

      if (isWhitelistedIp) {
        res.json({ success: true, viaIp: true, ip: clientIp });
      } else {
        res.status(401).json({ error: "Unauthorized", ip: clientIp });
      }
    });

    app.post("/api/admin/add-ip", (req, res) => {
      if (!isAdminAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
      const { ip } = req.body;
      if (!ip) return res.status(400).json({ error: "IP required" });

      try {
        const confPath = path.join(process.cwd(), 'config.json');
        let conf: any = {};
        if (fs.existsSync(confPath)) {
            conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
        }
        const allowedIPs = conf.allowedIPs || [];
        if (!allowedIPs.includes(ip)) {
          allowedIPs.push(ip);
          conf.allowedIPs = allowedIPs;
          fs.writeFileSync(confPath, JSON.stringify(conf, null, 2));
        }
        res.json({ success: true, allowedIPs });
      } catch (e) {
        res.status(500).json({ error: "Failed to update IPs" });
      }
    });

    const isAdminAuthenticated = (req: any) => {
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
      
      const confPath = path.join(process.cwd(), 'config.json');
      let allowedIPs: string[] = [];
      if (fs.existsSync(confPath)) {
          try {
            const conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
            allowedIPs = conf.allowedIPs || [];
          } catch (e) {
            return false;
          }
      }

      if (allowedIPs.includes(clientIp || '')) return true;
      
      console.log(`[ADMIN_AUTH_FAILED] IP: ${clientIp}`);
      return false;
    };

    app.get("/api/admin/config", (req, res) => {
      if (!isAdminAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
      try {
        const confPath = path.join(process.cwd(), 'config.json');
        let conf = {};
        if (fs.existsSync(confPath)) {
            conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
        }
        res.json(conf);
      } catch (e) {
        res.status(500).json({ error: "Failed to read global config" });
      }
    });

    app.post("/api/admin/config", (req, res) => {
      if (!isAdminAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
      try {
        const confPath = path.join(process.cwd(), 'config.json');
        let conf = {};
        if (fs.existsSync(confPath)) {
            conf = JSON.parse(fs.readFileSync(confPath, 'utf-8'));
        }
        const newConf = { ...conf, ...req.body };
        fs.writeFileSync(confPath, JSON.stringify(newConf, null, 2));
        addSystemLog("main_session", "Global admin config updated.", "info");
        res.json({ success: true });
      } catch (e) {
        res.status(500).json({ error: "Failed to update global config" });
      }
    });

    app.get("/api/admin/sessions", async (req, res) => {
      if (!isAdminAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
      const activeSessions = [];
      for (const [deviceId, instance] of instances) {
          if (instance.activeSocket && instance.userProfileCache) {
              activeSessions.push({
                  deviceId,
                  user: instance.userProfileCache,
                  status: instance.connectionStatus || 'connected'
              });
          }
      }
      res.json(activeSessions);
    });

    app.get("/api/admin/stats", async (req, res) => {
      if (!isAdminAuthenticated(req)) return res.status(401).json({ error: "Unauthorized" });
      res.json({ visitors: getActiveVisitorCount() });
    });

    app.post("/api/admin/reset-all", async (req, res) => {
      console.log("[ADMIN] Global reset requested");
      if (!isAdminAuthenticated(req)) {
        console.log("[ADMIN] Unauthorized reset attempt");
        return res.status(401).json({ error: "Unauthorized" });
      }
      addSystemLog("main_session", "GLOBAL SYSTEM RESET IN PROGRESS...", "error");
      try {
        await performFullSystemReset();
        addSystemLog("main_session", "GLOBAL SYSTEM RESET COMPLETED SUCCESSFULLY.", "success");
        res.json({ success: true });
      } catch (err: any) {
        console.error("[ADMIN] Reset failed:", err);
        res.status(500).json({ error: "Reset failed", message: err.message });
      }
    });

    app.post("/api/reset-system", async (req, res) => {
      const deviceId = getDeviceId(req);
      addSystemLog(deviceId, "SYSTEM RESET REQUESTED! Wiping all data.", "error");
      await performFullSystemReset();
      res.json({ success: true });
    });

    async function performFullSystemReset() {
      // Logout active instances in parallel
      const logoutPromises = [];
      for (const [dId, inst] of instances) {
        if (inst.activeSocket) {
          logoutPromises.push((async () => {
              try {
                await Promise.race([
                  inst.activeSocket.logout("user_requested"),
                  new Promise((resolve) => setTimeout(resolve, 5000))
                ]);
              } catch (e) {
                try { inst.activeSocket.end(new Error("Resetting")); } catch (e2) {}
              }
              inst.activeSocket = null;
          })());
        }
        inst.connectionStatus = "disconnected";
      }
      
      if (logoutPromises.length > 0) {
        await Promise.allSettled(logoutPromises);
      }
      
      instances.clear();

      // Small delay to ensure file handles are released
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Delete ALL session folders
      try {
        if (fs.existsSync(sessionsDir)) {
          const files = fs.readdirSync(sessionsDir);
          for (const file of files) {
              const p = path.join(sessionsDir, file);
              try {
                if (fs.statSync(p).isDirectory()) {
                    fs.rmSync(p, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(p);
                }
              } catch (fileErr) {
                console.error(`[RESET] Failed to remove ${p}:`, fileErr);
              }
          }
        }
      } catch (e) {
        console.error("Error deleting sessions directory:", e);
      }
      
      if (!fs.existsSync(sessionsDir)) {
          fs.mkdirSync(sessionsDir, { recursive: true });
      }

      // Delete temp folders and local junk files
      try {
        const tempDir = path.join(process.cwd(), 'temp');
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
        fs.mkdirSync(tempDir, { recursive: true });

        const rootFiles = fs.readdirSync(process.cwd());
        for (const file of rootFiles) {
            if (file.startsWith('tmp_') || file.startsWith('tts_') || file.startsWith('soft_')) {
                const filePath = path.join(process.cwd(), file);
                if (fs.statSync(filePath).isFile()) {
                    fs.unlinkSync(filePath);
                }
            }
        }
      } catch (e) {
        console.error("Error cleaning temp files:", e);
      }

      // Delete database and config for full reset
      try {
        const dbPath = path.join(process.cwd(), 'database.json');
        if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
        const configPath = path.join(process.cwd(), 'config.json');
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
      } catch (e) {
        console.error("Error deleting database/config files:", e);
      }

      addSystemLog("main_session", "Full system reset completed. All sessions and temp files deleted.", "info");
    }

    app.get("/api/qr", (req, res) => {
      const deviceId = getDeviceId(req);
      const instance = getInstance(deviceId);
      res.json({ qr: instance.activeQrCode });
    });

    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) =>
        res.sendFile(path.join(distPath, "index.html")),
      );
    }

    app.listen(PORT, "0.0.0.0", async () => {
      console.log(`[INIT] Server listening on 0.0.0.0:${PORT}`);
      startKeepAlive(`http://localhost:${PORT}/api/health`);
      startWhatsAppMonitor();
      if (fs.existsSync(sessionsDir)) {
          const folders = fs.readdirSync(sessionsDir);
          for (const s of folders) {
              if (s === ".keep") continue;
              addSystemLog(s, "Auto-resuming session...", "info");
              connectToWhatsApp(s).catch(() => {});
          }
      }
    });
  } catch (error: any) {
    console.error("[FATAL] Server failed to start:", error);
  }
}

// Graceful shutdown handling
async function forceReconnectBot(deviceId: string, reason: string) {
  console.log(`[WATCHDOG] Force reconnecting bot ${deviceId} due to: ${reason}`);
  const instance = getInstance(deviceId);
  
  if (instance.activeSocket) {
    try {
      (instance.activeSocket as any).isClosed = true;
      instance.activeSocket.end(new Error("Watchdog Force Reconnect: " + reason));
    } catch (e) {}
    instance.activeSocket = null;
  }
  instance.connectionStatus = "disconnected";
  
  setTimeout(() => {
    connectToWhatsApp(deviceId).catch((err) => {
      console.error(`[WATCHDOG] Error during force reconnect for ${deviceId}:`, err);
    });
  }, 2000);
}

function startWhatsAppMonitor() {
  setInterval(async () => {
    const now = moment().tz("Asia/Jakarta");
    const timeStr = now.format("HH.mm");
    for (const [deviceId, instance] of instances.entries()) {
      if (instance.connectionStatus === "connected" && instance.activeSocket) {
        const idleTime = Date.now() - instance.lastActivity;
        
        // WATCHDOG: If idle for more than 5 minutes, run a proactive liveness check
        if (idleTime > 5 * 60 * 1000 && !(instance as any)._checkingLiveness) {
          (instance as any)._checkingLiveness = true;
          console.log(`[WATCHDOG] Bot ${deviceId} has been idle for ${Math.floor(idleTime / 1000 / 60)} minutes. Running proactive liveness check...`);
          
          try {
            const sock = instance.activeSocket;
            // Send a presence update as a quick and lightweight liveness query to WhatsApp
            await Promise.race([
              sock.sendPresenceUpdate("available"),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Liveness ping timeout")), 8000))
            ]);
            
            // Liveness check succeeded! Update lastActivity to extend the idle timer
            console.log(`[WATCHDOG] Bot ${deviceId} liveness check succeeded. Connection is alive.`);
            instance.lastActivity = Date.now();
          } catch (err: any) {
            console.error(`[WATCHDOG] Bot ${deviceId} liveness check failed:`, err.message);
            // Reconnect immediately since the socket is dead or hung
            await forceReconnectBot(deviceId, `Liveness check failed (${err.message})`);
            continue; // Skip the rest of this tick for this instance
          } finally {
            (instance as any)._checkingLiveness = false;
          }
        }
        
        // WATCHDOG: Fallback to force restart if idle for more than 25 minutes
        if (idleTime > 25 * 60 * 1000) {
          console.log(`[WATCHDOG] Bot ${deviceId} idle threshold exceeded (${Math.floor(idleTime / 1000 / 60)} minutes). Forcing reconnect...`);
          await forceReconnectBot(deviceId, `Idle threshold exceeded`);
          continue; // Skip rest of this tick for this instance
        }
        
        // Group time-based settings
        try {
            const db = getDatabase();
            const groups = await (db as any).getAllGroups();
            for (const group of groups) {
                const openTimes = (group.opentime || "").split(',').map((s: string) => s.trim());
                const closeTimes = (group.closetime || "").split(',').map((s: string) => s.trim());
                
                if (openTimes.includes(timeStr)) {
                    await instance.activeSocket.groupSettingUpdate(group.id, 'not_announcement');
                    const groupMeta = await instance.activeSocket.groupMetadata(group.id);
                    const mentions = groupMeta.participants.map(p => p.id);
                    await instance.activeSocket.sendMessage(group.id, { 
                        text: `🔓 *ɢʀᴏᴜᴘ ᴏᴘᴇɴᴇᴅ*\n\n> Grup telah dibuka otomatis sesuai jadwal (*${timeStr}*).\n> Selamat berinteraksi! ✨`,
                        mentions,
                        contextInfo: { forwardedNewsletterMessageInfo }
                    }, { quoted: getVerifiedQuoted({ bot: { name: 'CMNTY-BOT' } }) as any });
                }
                if (closeTimes.includes(timeStr)) {
                    await instance.activeSocket.groupSettingUpdate(group.id, 'announcement');
                    await instance.activeSocket.sendMessage(group.id, { 
                        text: `🔒 *ɢʀᴏᴜᴘ ᴄʟᴏsᴇᴅ*\n\n> Grup telah ditutup otomatis sesuai jadwal (*${timeStr}*).\n> Waktunya istirahat, sampai jumpa besok! 💤`,
                        contextInfo: { forwardedNewsletterMessageInfo }
                    }, { quoted: getVerifiedQuoted({ bot: { name: 'CMNTY-BOT' } }) as any });
                }
            }
        } catch (e) {}
      }
    }
  }, 60 * 1000); // Check every minute
}

const handleExit = () => {
  console.log("Closing all WhatsApp connections gracefully...");
  for (const [deviceId, instance] of instances) {
    if (instance.activeSocket) {
      try {
        instance.activeSocket.end(new Error("Closed"));
      } catch (e) {}
    }
  }
  process.exit(0);
};

["SIGINT", "SIGTERM", "SIGUSR1", "SIGUSR2"].forEach((signal) => {
  process.on(signal, handleExit);
});

// Auto-cleanup every hour
cron.schedule('0 * * * *', () => {
    console.log('[CLEANUP] Starting hourly cleanup...');
    const tempDir = path.join(process.cwd(), 'temp');
    if (fs.existsSync(tempDir)) {
        try {
            fse.emptyDirSync(tempDir);
            console.log('[CLEANUP] Temp directory cleared.');
        } catch (err: any) {
            console.error('[CLEANUP] Failed to clear temp directory:', err.message);
        }
    }
    
    const tmpDir = path.join(process.cwd(), 'tmp');
    if (fs.existsSync(tmpDir)) {
        try {
            fse.emptyDirSync(tmpDir);
            console.log('[CLEANUP] Tmp directory cleared.');
        } catch (err: any) {
            console.error('[CLEANUP] Failed to clear tmp directory:', err.message);
        }
    }
    
    // Deleting any files in root that are NOT in the whitelist
    const whitelist = [
        'node_modules', 'dist', 'src', 'public', 'sessions', 
        'server.ts', 'package.json', 'package-lock.json', 
        'tsconfig.json', 'vite.config.ts', 'index.html', 
        'config.ts', '.gitignore', 'metadata.json', 
        'firebase-applet-config.json', 'firebase-blueprint.json', 
        'firestore.rules', 'Procfile', 'titles.txt', '.git'
    ];
    
    try {
        const rootFiles = fs.readdirSync(process.cwd());
        for (const file of rootFiles) {
            if (!whitelist.includes(file)) {
                const fullPath = path.join(process.cwd(), file);
                try {
                    const stats = fs.statSync(fullPath);
                    if (stats.isDirectory()) {
                        fse.removeSync(fullPath);
                    } else {
                        fs.unlinkSync(fullPath);
                    }
                    console.log(`[CLEANUP] Deleted: ${file}`);
                } catch (err: any) {
                    console.error(`[CLEANUP] Failed to delete ${file}:`, err.message);
                }
            }
        }
    } catch (err: any) {
        console.error('[CLEANUP] Error reading root directory:', err.message);
    }
    console.log('[CLEANUP] Cleanup finished.');
}, {
    timezone: "Asia/Jakarta"
});

startServer();
