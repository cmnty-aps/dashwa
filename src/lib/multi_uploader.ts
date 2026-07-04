import FormData from "form-data";
import axios from "axios";
import { fileTypeFromBuffer } from "file-type";
import mime from "mime-types";

const termaiKey = 'AIzaBj7z2z3xBjsk';
const termaiDomain = 'https://c.termai.cc';

async function detectExt(buffer: Buffer, fallback = 'bin') {
    try {
        const type = await fileTypeFromBuffer(buffer);
        return type?.ext || fallback;
    } catch {
        return fallback;
    }
}

export async function uploadToCatbox(buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('fileToUpload', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream'
    });

    const res = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (res.status !== 200) throw new Error('Catbox gagal');
    const url = res.data;
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('Invalid response');
    return { host: 'Catbox', url, expires: 'Permanent' };
}

export async function uploadToLitterbox(buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '72h');
    form.append('fileToUpload', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream'
    });

    const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (res.status !== 200) throw new Error('Litterbox gagal');
    const url = res.data;
    if (typeof url !== 'string' || !url.startsWith('http')) throw new Error('Invalid response');
    return { host: 'Litterbox', url, expires: '72 jam' };
}

export async function uploadToTmpFiles(buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('file', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream'
    });

    const res = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000
    });

    if (res.status !== 200) throw new Error('TmpFiles gagal');
    const data = res.data;
    if (!data?.data?.url) throw new Error('Invalid response');

    let url = data.data.url;
    const idMatch = url.match(/\/(\d+)(?:\/|$)/);
    if (idMatch) {
        url = `https://tmpfiles.org/dl/${idMatch[1]}/${filename}`;
    } else {
        url = url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    }

    return { host: 'TmpFiles', url, expires: '60 menit' };
}

export async function uploadToGofile(buffer: Buffer, filename: string) {
    const serverRes = await axios.get('https://api.gofile.io/servers', { timeout: 10000 });
    const serverData = serverRes.data;
    if (!serverData?.data?.servers?.[0]?.name) throw new Error('Gofile server gagal');

    const server = serverData.data.servers[0].name;
    const form = new FormData();
    form.append('file', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream'
    });

    const res = await axios.post(`https://${server}.gofile.io/uploadFile`, form, {
        headers: form.getHeaders(),
        timeout: 60000
    });

    if (res.status !== 200) throw new Error('Gofile upload gagal');
    const data = res.data;
    if (!data?.data?.downloadPage) throw new Error('Invalid response');
    return { host: 'Gofile', url: data.data.downloadPage, expires: 'Permanent' };
}

export async function uploadToQuax(buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('files[]', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream'
    });

    const res = await axios.post('https://qu.ax/upload.php', form, {
        headers: form.getHeaders(),
        timeout: 60000
    });

    if (res.status !== 200) throw new Error('Qu.ax gagal');
    const data = res.data;

    if (!data?.success || !Array.isArray(data.files) || !data.files[0]?.url) {
        throw new Error('Invalid response');
    }

    return { host: 'Qu.ax', url: data.files[0].url, expires: 'Permanent' };
}

export async function uploadToYpnk(buffer: Buffer, filename: string) {
    const form = new FormData();
    form.append('files', buffer, {
        filename,
        contentType: mime.lookup(filename) || 'application/octet-stream'
    });

    const res = await axios.post('https://cdn.ypnk.biz.id/upload', form, {
        headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36'
        },
        timeout: 120000
    });

    if (res.status !== 200) throw new Error('YPNK gagal');
    const data = res.data;

    if (!data?.success || !data?.files?.[0]?.url) {
        throw new Error('Invalid response');
    }

    return {
        host: 'YPNK',
        url: `https://cdn.ypnk.biz.id${data.files[0].url}`,
        expires: 'Unknown'
    };
}

export async function uploadToPutIcu(buffer: Buffer, filename: string) {
    const res = await axios.put('https://put.icu/upload/', buffer, {
        headers: {
            'Accept': 'application/json',
            'Content-Type': mime.lookup(filename) || 'application/octet-stream'
        },
        timeout: 120000
    });

    if (res.status !== 200) throw new Error('Put.icu gagal');
    const data = res.data;

    if (data?.direct_url) {
        return { host: 'Put.icu', url: data.direct_url, expires: '1 hari' };
    }

    if (data?.url) {
        return { host: 'Put.icu', url: data.url, expires: '1 hari' };
    }

    throw new Error('Invalid response');
}

export async function uploadToTermai(buffer: Buffer) {
    const ext = await detectExt(buffer, 'bin');
    const form = new FormData();
    form.append('file', buffer, { filename: `file.${ext}` });

    const res = await axios.post(`${termaiDomain}/api/upload?key=${termaiKey}`, form, {
        headers: form.getHeaders(),
        timeout: 120000
    });

    if (res.status !== 200) throw new Error('Termai gagal');
    const data = res.data;

    if (!data?.status || !data?.path) {
        throw new Error('Invalid response');
    }

    return { host: 'Termai', url: data.path, expires: 'Unknown' };
}

export const UPLOADERS = [
    { name: 'Catbox', fn: uploadToCatbox },
    { name: 'Litterbox', fn: uploadToLitterbox },
    { name: 'TmpFiles', fn: uploadToTmpFiles },
    { name: 'Gofile', fn: uploadToGofile },
    { name: 'Qu.ax', fn: uploadToQuax },
    { name: 'YPNK', fn: uploadToYpnk },
    { name: 'Put.icu', fn: uploadToPutIcu },
    { name: 'Termai', fn: uploadToTermai }
];
