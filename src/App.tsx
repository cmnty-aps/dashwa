import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import ReCAPTCHA from 'react-google-recaptcha';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Phone, CheckCircle2, Copy, RefreshCw, Loader2, ShieldCheck, 
  Settings, LayoutDashboard, Zap, AlertTriangle, Smartphone, 
  Menu, X, Server, MessageSquare, Shield, Activity, User, Save, Cpu, Clock, LogOut,
  Users, Hash, Briefcase, Image, Trash2, Radio, Send, MessageCircle, Bot, Eye, EyeOff, Lock, Key, Plus
} from 'lucide-react';

  const AdminPanel = () => {
    const [loading, setLoading] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isCheckingIp, setIsCheckingIp] = useState(true);
    const [clientIp, setClientIp] = useState('');
    const [newIp, setNewIp] = useState('');
    const [sessions, setSessions] = useState<any[]>([]);
    const [globalConfig, setGlobalConfig] = useState<any>({});
    const [configSaving, setConfigSaving] = useState(false);
    const [stats, setStats] = useState<{ visitors: number }>({ visitors: 0 });

    const checkAuth = async () => {
      setIsCheckingIp(true);
      try {
        const res = await fetch('/api/admin/check-auth');
        const data = await res.json();
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
        }
        setClientIp(data.ip || '');
      } catch (e) {
        setIsAuthenticated(false);
      }
      setIsCheckingIp(false);
    };

    const handleLogout = () => {
      // With IP-only auth, logout just prevents current UX session but won't really "deauth" IP
      setIsAuthenticated(false);
    };

    useEffect(() => {
      checkAuth();
    }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/admin/sessions');
      const data = await res.json();
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      setSessions([]);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats');
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/admin/config');
      const data = await res.json();
      setGlobalConfig(data);
    } catch (e) {
      console.error(e);
    }
  };

  const saveConfig = async () => {
    setConfigSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(globalConfig)
      });
      if (res.ok) {
        alert('✅ Konfigurasi berhasil disimpan!');
      } else {
        alert('❌ Gagal menyimpan konfigurasi.');
      }
    } catch (e) {
      alert('❌ Error saat menyimpan konfigurasi.');
    }
    setConfigSaving(false);
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchSessions();
    fetchConfig();
    fetchStats();
    const interval = setInterval(() => {
      fetchSessions();
      fetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  const handleReset = async () => {
    const pass = prompt("⚠️ PERHATIAN: Ini akan menghapus SEMUA sesi pada server.\nKetik 'RESET' untuk konfirmasi:");
    if (pass?.toUpperCase() !== 'RESET') return;
    
    setLoading(true);
    try {
      const res = await fetch('/api/admin/reset-all', { 
        method: 'POST'
      });
      if (res.ok) {
        alert('✅ Semua sesi berhasil dihapus.');
        fetchSessions();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert(`❌ Gagal menghapus sesi: ${errData.error || res.statusText || 'Unknown Error'}`);
      }
    } catch (e) {
      alert("❌ Gagal menghapus sesi");
    }
    setLoading(false);
  };

  if (isCheckingIp) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#85C1E9] font-sans p-4">
        <div className="bg-white border-8 border-black p-8 max-w-sm w-full text-center shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-4">
          <Loader2 size={48} className="animate-spin text-blue-600" />
          <p className="font-black uppercase text-xl">Mengecek Akses...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated && !isCheckingIp) {
    window.location.replace('/');
    return null;
  }

  return (
    <div className="min-h-[100dvh] bg-[#85C1E9] font-sans p-3 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div 
          className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 bg-[#AED6F1] border-x-4 border-b-4 border-black p-6 md:p-8 shadow-[0_4px_0_0_rgba(0,0,0,0.1)] gap-4 relative overflow-hidden"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 96% 100%, 4% 100%)' }}
        >
          {/* Header Background Video with diagonal split */}
          <div 
            className="absolute inset-0 left-0 w-full h-full pointer-events-none opacity-30 z-0"
            style={{ 
              clipPath: 'polygon(60% 0%, 100% 0%, 100% 100%, 40% 100%)' 
            }}
          >
            <video 
              autoPlay 
              muted 
              loop 
              playsInline 
              className="w-full h-full object-cover"
            >
              <source src="https://c.termai.cc/v104/N1zu.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="relative z-10">
            <h1 className="text-xl md:text-3xl font-black uppercase tracking-tighter truncate w-full md:w-auto">Panel Admin</h1>
            <div className="text-sm font-bold flex gap-4 mt-1">
              <span>Sesi Aktif: {sessions.length}</span>
              <span className="flex items-center gap-1"><Users size={16} /> Visitor: {stats.visitors}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 w-full md:w-auto relative z-10">
            <button onClick={() => { fetchSessions(); fetchStats(); }} className="flex-1 bg-black text-white p-2.5 md:p-3 font-bold uppercase hover:bg-gray-800 text-xs md:text-sm">Refresh</button>
            <button onClick={handleLogout} className="flex-1 bg-white border-4 border-black text-black p-2.5 md:p-3 font-bold uppercase hover:bg-gray-100 flex items-center justify-center gap-1 text-xs md:text-sm">
              <LogOut size={16} /> Keluar
            </button>
            <button onClick={handleReset} className="flex-1 bg-red-600 border-4 border-black text-white p-2.5 md:p-3 font-bold uppercase hover:bg-red-700 flex items-center justify-center gap-1 text-xs md:text-sm">
              <Trash2 size={16} /> Reset
            </button>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-black text-white border-4 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <h2 className="text-xs uppercase font-bold opacity-70">Total Aktif</h2>
            <p className="text-3xl font-black">{sessions.length}</p>
          </div>
          <div className="bg-white text-black border-4 border-black p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-between">
            <div>
              <h2 className="text-xs uppercase font-bold text-gray-500">Status Server</h2>
              <p className="text-xl font-black uppercase text-green-600">Online</p>
            </div>
          </div>
        </div>

        <div className="bg-[#AED6F1] border-4 border-black p-4 md:p-6 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] mb-6">
          <div className="flex items-center gap-3 border-b-4 border-black pb-2 mb-4">
            <Settings size={24} className="text-black" />
            <h2 className="text-xl font-black uppercase">Global Bot Configuration</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Nama Bot Global</label>
              <input
                type="text"
                placeholder="Masukkan nama bot global..."
                value={globalConfig.botName || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, botName: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Share Channel Link</label>
              <input
                type="text"
                placeholder="Masukkan link saluran WhatsApp Anda..."
                value={globalConfig.channelLink || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, channelLink: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Share Channel Name</label>
              <input
                type="text"
                placeholder="Masukkan nama saluran Anda..."
                value={globalConfig.channelName || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, channelName: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Target Newsletter Context ID</label>
              <input
                type="text"
                placeholder="Masukkan ID context newsletter..."
                value={globalConfig.channelId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, channelId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Follow Newsletter ID 1</label>
              <input
                type="text"
                placeholder="Masukkan ID newsletter pertama..."
                value={globalConfig.autoFollowChannelId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoFollowChannelId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Follow Newsletter ID 2</label>
              <input
                type="text"
                placeholder="Masukkan ID newsletter kedua..."
                value={globalConfig.autoFollowChannelId2 || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoFollowChannelId2: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Follow Newsletter ID 3</label>
              <input
                type="text"
                placeholder="Masukkan ID newsletter ketiga..."
                value={globalConfig.autoFollowChannelId3 || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoFollowChannelId3: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Auto Join Group JID</label>
              <input
                type="text"
                placeholder="Masukkan JID grup (Contoh: 123456@g.us)..."
                value={globalConfig.autoJoinGroupId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, autoJoinGroupId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Thumbnail URL</label>
              <input
                type="text"
                placeholder="Masukkan URL gambar thumbnail..."
                value={globalConfig.thumbnailUrl || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, thumbnailUrl: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Tako Username</label>
              <input
                type="text"
                placeholder="Masukkan username akun Tako Anda..."
                value={globalConfig.takoUsername || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, takoUsername: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black uppercase text-gray-600">Saweria User ID</label>
              <input
                type="text"
                placeholder="Masukkan User ID Saweria Anda..."
                value={globalConfig.saweriaUserId || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, saweriaUserId: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Neoxr API Key</label>
              <input
                type="text"
                placeholder="Default: CMNTY-BOT"
                value={globalConfig.neoxrApiKey || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, neoxrApiKey: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-black uppercase text-gray-600">Nevapedia API Key</label>
              <input
                type="text"
                placeholder="Masukkan Nevapedia API Key Anda..."
                value={globalConfig.nevapediaApiKey || ''}
                onChange={e => setGlobalConfig({ ...globalConfig, nevapediaApiKey: e.target.value })}
                className="w-full bg-white border-4 border-black p-2 font-bold focus:bg-gray-50 outline-none"
              />
            </div>
            <div className="space-y-1 md:col-span-2 bg-white/50 p-4 border-2 border-black border-dashed mt-4">
              <label className="text-sm font-black uppercase text-red-600 flex items-center gap-2">
                <Shield size={16} /> 🛡️ IP Access Whitelist
              </label>
              <p className="text-[10px] font-bold text-gray-600 mb-3">Daftar alamat IP yang diizinkan mengakses panel ini.</p>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {globalConfig.allowedIPs && globalConfig.allowedIPs.length > 0 ? (
                  globalConfig.allowedIPs.map((ip: string) => (
                    <div key={ip} className="bg-black text-white px-3 py-1 flex items-center gap-2 font-mono text-xs border-2 border-black group">
                      <span>{ip}</span>
                      <button 
                        type="button"
                        onClick={() => {
                          if (ip === '160.19.86.23') return;
                          const filtered = globalConfig.allowedIPs.filter((item: string) => item !== ip);
                          setGlobalConfig({ ...globalConfig, allowedIPs: filtered });
                        }}
                        className={`hover:text-red-400 transition-colors ${ip === '160.19.86.23' ? 'opacity-30 cursor-not-allowed' : ''}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="text-[10px] font-bold text-gray-400 italic">Belum ada IP yang terdaftar.</p>
                )}
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Tambah alamat IP (Misal: 103.245.x.x)"
                  value={newIp}
                  onChange={(e) => setNewIp(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newIp) {
                        const current = globalConfig.allowedIPs || [];
                        if (!current.includes(newIp)) {
                          setGlobalConfig({ ...globalConfig, allowedIPs: [...current, newIp] });
                          setNewIp('');
                        }
                      }
                    }
                  }}
                  className="w-full bg-white border-4 border-black p-2 font-bold font-mono text-sm outline-none focus:bg-gray-50 h-10"
                />
                <button 
                  type="button"
                  onClick={() => {
                    if (newIp) {
                      const current = globalConfig.allowedIPs || [];
                      if (!current.includes(newIp)) {
                        setGlobalConfig({ ...globalConfig, allowedIPs: [...current, newIp] });
                        setNewIp('');
                      }
                    }
                  }}
                  className="bg-black text-white px-4 h-10 font-black uppercase text-xs shadow-[4px_4px_0px_0px_rgba(59,130,246,1)] hover:translate-x-1 hover:translate-y-1 hover:shadow-none active:translate-x-1.5 active:translate-y-1.5 transition-all flex items-center justify-center gap-2"
                >
                  <Plus size={16} />
                  ➕ TAMBAH
                </button>
              </div>

              <p className="text-[10px] font-black text-gray-500 mt-3 uppercase">IP Anda saat ini: <span className="text-black font-mono">{clientIp}</span></p>
            </div>
          </div>
          
          <button 
            onClick={saveConfig}
            disabled={configSaving}
            className="mt-4 w-full bg-black text-white p-3 font-bold uppercase transition hover:bg-gray-800 flex items-center justify-center gap-2 text-xs md:text-sm"
          >
            {configSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            <span className="truncate">Simpan Konfigurasi Global</span>
          </button>
        </div>

        {loading && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
            <div className="bg-white border-4 border-black p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col items-center gap-4">
              <Loader2 className="animate-spin text-black" size={32} />
              <h2 className="text-lg font-black uppercase tracking-tighter">Memproses...</h2>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((s) => (
            <div key={s.deviceId} className="bg-[#AED6F1] border-4 border-black p-5 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex items-start gap-4 hover:-translate-y-1 transition-transform group">
               <div className="w-16 h-16 border-2 border-black bg-gray-200 overflow-hidden flex-shrink-0">
                 <img src={s.user?.profilePic || 'https://via.placeholder.com/64'} alt="Profile" className="w-full h-full object-cover" />
               </div>
               <div className="overflow-hidden min-w-0 flex-1">
                  <h3 className="font-black text-lg truncate group-hover:text-purple-700 transition">
                    {(!s.user?.name || s.user.name.toLowerCase() === 'unknown') 
                        ? (s.user?.id?.split('@')[0] || 'Unknown') 
                        : s.user.name
                    }
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                      <p className="font-mono text-[10px] text-gray-600 truncate bg-gray-100 p-1 rounded-sm border border-black">{s.deviceId}</p>
                      <button 
                        onClick={() => {
                            navigator.clipboard.writeText(s.deviceId);
                            alert('Device ID disalin!');
                        }}
                        className="p-1 hover:bg-gray-200"
                        title="Salin ID"
                      >
                          <Copy size={12} />
                      </button>
                      <button 
                        onClick={async () => {
                            if (!confirm(`Hapus dan log out perangkat ${s.deviceId}?`)) return;
                            try {
                                const res = await fetch(`/api/logout?deviceId=${s.deviceId}`, { method: 'POST' });
                                if (res.ok) {
                                    alert('Perangkat berhasil dikeluarkan dari WhatsApp.');
                                    fetchSessions();
                                }
                            } catch (e) {
                                alert('Error mengeluarkan perangkat');
                            }
                        }}
                        className="p-1 hover:bg-red-200 text-red-600 ml-auto"
                        title="Keluarkan & Hapus Sesi"
                      >
                          <LogOut size={12} />
                      </button>
                  </div>
                  <p className="font-mono text-xs text-gray-600 truncate mt-1">{s.user?.id?.split('@')[0] || 'Unknown ID'}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.status === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}`}></span>
                    <span className="text-[10px] font-bold uppercase">{s.status}</span>
                  </div>
               </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function App() {
  if (window.location.pathname.startsWith('/p-cmnty')) {
    return <AdminPanel />;
  }

  const [deviceId] = useState<string>(() => {
    const saved = localStorage.getItem('bot_device_id');
    if (saved && saved.startsWith('device_')) return saved;
    const newId = 'device_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('bot_device_id', newId);
    return newId;
  });

  const [activeTab, setActiveTab] = useState<'overview' | 'pairing' | 'settings'>('pairing');
  const [botStatus, setBotStatus] = useState<{ 
    connected: boolean; 
    sessionExists: boolean; 
    status?: 'disconnected' | 'connecting' | 'connected';
    memoryUsageMB?: number;
    uptimeSeconds?: number;
    user?: { id: string; name: string, profilePic?: string } | null;
    metrics?: { messagesProcessed: number, activeGroupsCount: number };
    logs?: { time: string, message: string, type: 'info' | 'warn' | 'error' | 'success' }[];
  }>({ connected: false, sessionExists: false });
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isPhoneNumberVisible, setIsPhoneNumberVisible] = useState(false);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [localUptime, setLocalUptime] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [showFollowPopup, setShowFollowPopup] = useState(true);

  const initialDataFetchedRef = useRef(false);
  const notificationAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("https://c.termai.cc/a147/8c6DsM.mp3");
    audio.preload = "auto";
    notificationAudioRef.current = audio;
  }, []);

  const [placeholderText, setPlaceholderText] = useState("");
  const targetText = "Suport semua nomer...";

  useEffect(() => {
    let currentIndex = 0;
    const interval = setInterval(() => {
      currentIndex = (currentIndex + 1) % (targetText.length + 1);
      setPlaceholderText(targetText.substring(0, currentIndex));
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const maskPhoneNumber = (num: string | undefined | null) => {
    if (!num) return '...';
    const clean = num.split('@')[0].replace(/[^0-9]/g, '');
    if (clean.length < 8) return clean;
    return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
  };


  // Mascot Slider State
  const mascotImages = [
    "https://c.termai.cc/i128/TJX8.jpg",
    "https://c.termai.cc/i101/bDwEx.jpg",
    "https://c.termai.cc/i179/ED9G.jpg",
    "https://c.termai.cc/i178/HT9I2FQ.jpg",
    "https://c.termai.cc/i123/SX2W.jpg",
    "https://c.termai.cc/i185/KdNY.jpg"
  ];
  const [currentMascotIndex, setCurrentMascotIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentMascotIndex((prev) => (prev + 1) % mascotImages.length);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Config State
  const [config, setConfig] = useState<any>(null);
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    // Initial fetch
    fetchStatus();
    fetchConfig();

    // Set up rapid polling interval
    const interval = setInterval(() => fetchStatus(), 5000);
    return () => clearInterval(interval);
  }, []); // Run once on mount

  useEffect(() => {
    const timer = setInterval(() => {
      setLocalUptime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'settings' && !config) fetchConfig();
  }, [activeTab]);

  useEffect(() => {
    if (botStatus.connected && pairingCode) {
      setPairingCode(null);
      setActiveTab('overview');
    }
    // Block access to dashboard tabs if not connected AND no session exists.
    // If session exists (disconnected/connecting/connected), allow dashboard access.
    if (initialDataFetchedRef.current && !botStatus.sessionExists && ['overview', 'settings'].includes(activeTab)) {
      setActiveTab('pairing');
    }
  }, [botStatus.connected, botStatus.sessionExists, pairingCode, activeTab]);


  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/status?deviceId=${deviceId}`);
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (res.ok && isJson) {
        const data = await res.json();
        
        // Sync local uptime with server uptime
        if (data.uptimeSeconds !== undefined) {
          setLocalUptime(data.uptimeSeconds);
        }

        if (!initialDataFetchedRef.current) {
          // If the server confirms a session exists, we go straight to dashboard
          if (data.sessionExists) {
            setActiveTab('overview');
          } else {
            // Otherwise ensure we are at pairing
            setActiveTab('pairing');
          }
          initialDataFetchedRef.current = true;
          setIsInitialLoad(false);
        }

        setBotStatus(prev => {
           // Prevent UI from flapping if backend is just doing a quick transparent reconnect
           if (prev.connected && data.status !== 'connected' && data.sessionExists) {
               return { ...data, connected: true, status: 'connected' };
           }
           return data;
        });
      }
    } catch (err: any) {
      console.warn('Backend is unreachable (perhaps restarting?):', err.message);
    } finally {
      if (!initialDataFetchedRef.current) {
        initialDataFetchedRef.current = true;
        setIsInitialLoad(false);
      }
    }
  };

  const handleReconnect = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reconnect?deviceId=${deviceId}`, { method: 'POST' });
      if (res.ok) fetchStatus();
    } catch (err) {
      console.error('Reconnect failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Apakah Anda yakin ingin keluar dan menghapus sesi?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/logout?deviceId=${deviceId}`, { method: 'POST' });
      if (res.ok) {
        setPairingCode(null);
        fetchStatus();
        setActiveTab('pairing');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelPairing = async () => {
    setLoading(true);
    try {
      await fetch(`/api/logout?deviceId=${deviceId}`, { method: 'POST' });
      setPairingCode(null);
      setPhoneNumber('');
      await fetchStatus();
    } catch (err) {
      console.error('Cancel pairing failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSystem = async () => {
    if (!confirm('PERINGATAN: Ini akan menghapus SEMUA sesi dan mereset sistem bot secara paksa. Gunakan hanya jika terjadi error koneksi berulang (Error 440). Lanjutkan?')) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reset-system?deviceId=${deviceId}`, { method: 'POST' });
      if (res.ok) {
        alert('Sistem berhasil direset. Silakan Refresh browser!');
        window.location.reload();
      } else {
        alert('Gagal mereset sistem.');
      }
    } catch (err) {
      console.error('Reset failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await fetch(`/api/config?deviceId=${deviceId}`);
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (res.ok && isJson) {
        const data = await res.json();
        setConfig(data);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
    } finally {
      setConfigLoading(false);
    }
  };

  const saveConfig = async () => {
    setConfigLoading(true);
    try {
      await fetch(`/api/config?deviceId=${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      alert('Config saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to save config');
    } finally {
      setConfigLoading(false);
    }
  };

  const updateToggle = async (field: string, value: boolean | string, additionalFields?: Record<string, any>) => {
    if (!config) return;
    const updatedConfig = { ...config, [field]: value, ...additionalFields };
    setConfig(updatedConfig);
    try {
      await fetch(`/api/config?deviceId=${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedConfig),
      });
    } catch (err: any) {
      console.error('Gagal menyimpan otomatis:', err);
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber) return;

    let formattedPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = '62' + formattedPhone.slice(1);
    }

    setLoading(true);
    setError(null);
    setPairingCode(null);

    try {
      const response = await fetch(`/api/pair?deviceId=${deviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          phone: formattedPhone, 
          method: 'pairing-code'
        }),
      });

      const isJson = response.headers.get('content-type')?.includes('application/json');
      if (!isJson) {
        setError('Server error: received non-JSON response. You might be rate-limited.');
        return;
      }
      
      const data = await response.json();
      if (response.ok) {
        setPairingCode(data.code);
      } else {
        setError(data.error || 'Something went wrong');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Helpers
  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    if (d > 0) return `${d}h ${h}m ${m}s`;
    return `${h}h ${m}m ${s}s`;
  };

  // UI Components
  const NavItem = ({ id, icon: Icon, label }: { id: typeof activeTab, icon: any, label: string }) => (
    <button
      onClick={() => { setActiveTab(id); setIsMobileMenuOpen(false); }}
      className={`w-full flex items-center gap-3 px-3 py-3 font-serif text-xs md:text-sm transition-all duration-75 border-4 ${
        activeTab === id 
          ? 'bg-wa-accent text-black border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] -translate-y-1 -translate-x-1' 
          : 'bg-[#5DADE2] text-white border-black hover:bg-white hover:text-black hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-1 hover:-translate-x-1'
      }`}
    >
      <Icon size={18} className="shrink-0" />
      <span className="truncate uppercase font-black">{label}</span>
    </button>
  );

  if (isInitialLoad) {
    return (
      <div className="flex h-[100dvh] bg-[#85C1E9] text-black font-sans items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 pattern-dots" />
        <div className="flex flex-col items-center gap-4 border-8 border-black p-8 bg-[#AED6F1] shadow-[12px_12px_0px_0px_#ffffff] z-10 w-full max-w-sm mx-4 text-center">
          <Loader2 size={48} className="animate-spin text-black" />
          <h2 className="text-xl font-black uppercase">LOADING</h2>
          <p className="text-sm font-bold text-gray-600">Please waiting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] font-sans text-black overflow-hidden relative selection:bg-wa-accent selection:text-black pb-[env(safe-area-inset-bottom)]">
      
    <div className="lg:hidden fixed top-0 left-0 right-0 h-20 z-50 flex items-start justify-center pointer-events-none">
        <div 
          className="bg-[#85C1E9] border-x-4 border-b-4 border-black h-16 w-full flex items-center px-6 pointer-events-auto relative shadow-[0_4px_0_0_rgba(0,0,0,0.1)] overflow-hidden"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 96% 100%, 4% 100%)' }}
        >
            {/* Header Background Video with diagonal split */}
            <div 
              className="absolute inset-0 left-0 w-full h-full pointer-events-none opacity-30 z-0"
              style={{ 
                clipPath: 'polygon(60% 0%, 100% 0%, 100% 100%, 40% 100%)' 
              }}
            >
              <video 
                autoPlay 
                muted 
                loop 
                playsInline 
                className="w-full h-full object-cover"
              >
                <source src="https://c.termai.cc/v104/N1zu.mp4" type="video/mp4" />
              </video>
            </div>
            {/* Logo Stylized */}
            <div className="flex items-center gap-2 bg-wa-accent border-4 border-black px-2 py-0.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] -translate-x-1 relative z-10">
              <div className="w-5 h-5 flex items-center justify-center bg-white border-2 border-black rotate-3">
                 <Bot size={12} fill="gray" />
              </div>
              <span className="text-black font-black uppercase tracking-tighter text-[10px]">CMNTY</span>
            </div>
            
            {/* Marquee */}
            <div className="flex-1 overflow-hidden relative flex items-center h-full mask-image-gradient mx-2 z-10">
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity, duration: 40, ease: "linear" }}
                className="whitespace-nowrap font-marquee font-bold text-xs tracking-tight inline-flex"
              >
                <span className="inline-block px-4">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
                <span className="inline-block px-4">Jalankan bot WhatsApp dengan mudah via website. Bangun otomatisasi cerdas dalam hitungan menit tanpa ribet teknis. Lengkap, aman, dan modern.</span>
              </motion.div>
            </div>
    
            {/* Menu Button */}
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} 
              className={`p-1.5 border-4 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-transform active:translate-x-0.5 active:translate-y-0.5 active:shadow-none shrink-0 relative z-10 ${isMobileMenuOpen ? 'bg-red-400' : 'bg-wa-accent'}`}
            >
              {isMobileMenuOpen ? <X size={18} className="text-black" /> : <Menu size={18} className="text-black" />}
            </button>
        </div>
      </div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-40 w-[80vw] max-w-[280px] lg:w-72 bg-[#85C1E9] border-r-4 border-black transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative flex flex-col`}>
        <div 
          className="h-44 hidden lg:flex items-center px-4 md:px-6 border-b-4 border-black bg-[#AED6F1] text-black relative overflow-hidden"
          style={{ clipPath: 'polygon(0% 0%, 100% 0%, 94% 100%, 6% 100%)' }}
        >
          {/* Sidebar Header Background Video with diagonal split */}
          <div 
            className="absolute inset-0 left-0 w-full h-full pointer-events-none opacity-30 z-0"
            style={{ 
              clipPath: 'polygon(60% 0%, 100% 0%, 100% 100%, 40% 100%)' 
            }}
          >
            <video 
              autoPlay 
              muted 
              loop 
              playsInline 
              className="w-full h-full object-cover"
            >
              <source src="https://c.termai.cc/v104/N1zu.mp4" type="video/mp4" />
            </video>
          </div>
          <div className="flex flex-col gap-3 w-full -mt-4 relative z-10">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-wa-accent flex items-center justify-center border-4 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] shrink-0 z-10 relative overflow-hidden group">
                <div className="flex items-center -space-x-1 transition-transform group-hover:scale-110">
                  <Bot size={22} fill="white" className="text-black" />
                  <Send size={20} className="-rotate-12 text-wa-accent fill-black" />
                </div>
              </div>
              <div className="flex flex-col select-none">
                <span className="text-2xl font-black uppercase tracking-tighter leading-none border-b-4 border-black bg-white px-1">CMNTY</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] bg-black text-wa-accent px-1">SYSTEM BOT</span>
              </div>
            </div>
            
            <div className="overflow-hidden relative flex items-center mask-image-gradient py-1 bg-white border-2 border-black">
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity, duration: 60, ease: "linear" }}
                className="whitespace-nowrap font-marquee font-bold text-[9px] tracking-widest uppercase inline-flex"
              >
                <span className="inline-block px-8">CMNTY BOT • AUTOMATION • FAST • SECURE • MODERN • </span>
                <span className="inline-block px-8">CMNTY BOT • AUTOMATION • FAST • SECURE • MODERN • </span>
              </motion.div>
            </div>
          </div>
        </div>

        <div className="flex-1 px-3 py-6 md:px-4 md:py-8 mt-16 lg:mt-0 font-serif text-black flex flex-col overflow-y-auto">
          
          <div className="space-y-3 md:space-y-4">
            {botStatus.connected ? (
              <>
                <NavItem id="overview" icon={LayoutDashboard} label="Dashboard" />
              </>
            ) : (
              <div className="px-3 py-4 text-[10px] font-bold bg-amber-100 text-black pixel-border border-dashed text-center break-words leading-tight mt-3">
                Tautkan perangkat untuk akses dashboard
              </div>
            )}
          </div>
          
          <div className="pt-4 mt-4 md:mt-6 border-t-4 border-black border-dashed">
            <NavItem id="pairing" icon={Smartphone} label={botStatus.connected ? "Perangkat" : "tautkan perangkat"} />
          </div>
          
          <div className="mt-8 mb-4 flex-1 flex flex-col justify-end items-center px-2">
            <div 
              className="relative w-full max-w-[260px] mx-auto select-none pointer-events-none"
              onContextMenu={(e) => e.preventDefault()}
            >
              <img 
                src={mascotImages[currentMascotIndex]} 
                alt="Bot Mascot" 
                className="w-full h-auto object-contain pointer-events-none"
                loading="lazy"
                draggable={false}
              />
            </div>
          </div>
        </div>

        <div className="p-4 border-t-4 border-black bg-[#85C1E9]">
          <div className={`flex items-center gap-3 px-3 py-3 bg-white pixel-border pixel-shadow-sm`}>
            <div className={`w-3 h-3 md:w-4 md:h-4 shrink-0 border-2 border-black ${botStatus.connected ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500 shadow-[0_0_10px_#ef4444]'}`}></div>
            <div className="flex flex-col font-serif overflow-hidden">
                <span className="text-sm md:text-xl font-bold truncate drop-shadow-[1px_1px_0px_#fff]">
                  {botStatus.connected 
                    ? ((!config?.botName || config.botName === 'Bot Matrix' || config.botName === 'Matrix Bot' || config.botName === 'CMNTY-BOT' || config.botName === 'unknown') 
                        ? (botStatus.user?.name && botStatus.user?.name !== 'unknown' ? botStatus.user.name : 'CMNTY-BOT') 
                        : config.botName) 
                    : 'TERPUTUS'}
                </span>
                {botStatus.connected && (
                <span className="text-[10px] md:text-xs opacity-60 truncate">
                  {botStatus.user?.id ? `+${maskPhoneNumber(botStatus.user.id.split('@')[0])}` : 'Connecting...'}
                  {botStatus.user?.name && botStatus.user.name !== "unknown" && ` (${botStatus.user.name})`}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative pt-16 lg:pt-0">
        <main className="w-full max-w-6xl mx-auto p-4 md:p-6 lg:p-10 relative z-10 min-h-full flex flex-col pt-6 md:pt-8 lg:pt-10">
          
          <AnimatePresence mode="wait">
            
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 w-full max-w-[100vw]">
                <div>
                  <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase text-black drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">DASHBOARD</h1>
                  <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Statistik Sistem Real-time</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 text-black">
                  {/* Card 1: User Profile & Session */}
                  <div className="bg-[#AED6F1] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-4 md:gap-6 md:col-span-2 lg:col-span-1">
                    <div className="flex items-center gap-3 md:gap-4">
                      <div className="w-12 h-12 md:w-16 md:h-16 bg-gray-200 text-black pixel-border border-2 flex items-center justify-center shrink-0 overflow-hidden relative group">
                        {botStatus.user?.profilePic ? (
                          <img 
                            src={botStatus.user.profilePic} 
                            alt="Profile" 
                            referrerPolicy="no-referrer" 
                            className="w-full h-full object-cover" 
                            onError={(e) => {
                                // If image fails, fallback to icon
                                e.currentTarget.style.display = 'none';
                                const next = e.currentTarget.nextElementSibling as HTMLElement;
                                if (next) next.style.display = 'flex';
                            }}
                          />
                        ) : null}
                        <div className={`${botStatus.user?.profilePic ? 'hidden' : 'flex'} w-full h-full items-center justify-center`}>
                           <User size={24} className="md:w-8 md:h-8" />
                        </div>
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-mono text-[10px] text-gray-600 truncate bg-gray-100 p-1 rounded-sm border border-black">{deviceId}</p>
                            <button 
                              onClick={() => {
                                  navigator.clipboard.writeText(deviceId);
                                  alert('Device ID disalin!');
                              }}
                              className="p-1 hover:bg-gray-200 border border-black bg-white"
                              title="Salin Device ID"
                            >
                                <Copy size={10} />
                            </button>
                          </div>
                          
                          <div className="flex items-center gap-2 font-bold text-xs md:text-sm opacity-90 italic">
                               <Smartphone size={14} className="shrink-0 text-blue-600" />
                               <span className="truncate underline decoration-2 decoration-blue-200 underline-offset-2">
                                 {botStatus.user?.id ? '+' + maskPhoneNumber(botStatus.user.id.split('@')[0]) : 'Menghubungkan...'}
                               </span>
                               {botStatus.user?.name && botStatus.user.name !== "unknown" && (
                                 <span className="truncate ml-1 bg-black text-white px-1 -skew-x-12 inline-block not-italic text-[10px] md:text-xs">
                                   ({botStatus.user.name})
                                 </span>
                               )}
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex flex-row gap-2 md:gap-4 mt-auto font-serif">
                      <button onClick={() => setActiveTab('settings')} className="pixel-button bg-blue-400 text-black p-2 flex justify-center text-lg md:text-xl item-center aspect-square shrink-0">
                        <Settings size={18} className="md:w-5 md:h-5" />
                      </button>
                      <button onClick={botStatus.connected ? handleLogout : () => setActiveTab('pairing')} disabled={loading} className="pixel-button flex-1 bg-red-400 text-white px-2 py-2 flex justify-center text-sm md:text-xl items-center gap-2 truncate">
                        {loading ? <Loader2 size={16} className="animate-spin" /> : botStatus.connected ? <><LogOut size={16} /><span className="truncate">LOGOUT</span></> : 'TAUTAN'}
                      </button>
                    </div>
                  </div>

                  {/* Card 2: Memory Usage */}
                  <div className="bg-[#facc15] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate">MEMORI RAM</span>
                      <Cpu size={20} className="md:w-6 md:h-6 shrink-0" />
                    </div>
                    <div className="mt-auto flex justify-center items-baseline pt-2 md:pt-4">
                      <span className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">{botStatus.memoryUsageMB || 0}</span>
                      <span className="font-serif font-bold ml-1 md:ml-2 text-xl md:text-3xl">MB</span>
                    </div>
                  </div>
                  
                  {/* Card 3: Server Uptime */}
                  <div className="bg-[#4ade80] pixel-border pixel-shadow p-4 md:p-6 flex flex-col gap-3 md:gap-4 relative">
                    <div className="flex items-center justify-between font-serif font-bold border-b-4 border-black pb-2 text-sm md:text-xl uppercase shrink-0">
                      <span className="truncate">WAKTU AKTIF</span>
                      <Clock size={20} className="md:w-6 md:h-6 shrink-0" />
                    </div>
                    <div className="mt-auto flex justify-center pt-2 md:pt-4">
                      <span className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight">
                        {formatUptime(localUptime)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:gap-6 mt-6 text-black">
                  {/* Network Stats */}
                  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                    <div className="bg-[#AED6F1] flex-1 text-black pixel-border pixel-shadow p-4 md:p-6 flex items-center justify-between hover:bg-blue-100 transition-colors">
                      <div className="overflow-hidden">
                        <div className="font-serif text-sm md:text-lg font-bold uppercase mb-1 truncate">TOTAL GRUP</div>
                        <div className="text-3xl md:text-5xl font-bold truncate">{botStatus.metrics?.activeGroupsCount || 0}</div>
                      </div>
                      <div className="w-12 h-12 md:w-16 md:h-16 shrink-0 bg-blue-400 pixel-border border-2 flex items-center justify-center">
                        <Users size={24} className="md:w-8 md:h-8" />
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* PAIRING TAB */}
            {activeTab === 'pairing' && (
              <motion.div key="pairing" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="flex-1 flex flex-col justify-center w-full min-h-[85vh] lg:min-h-0 mx-auto w-full max-w-4xl px-2 sm:px-0">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10 items-center">
                  <div className="flex flex-col justify-center text-center lg:text-left mt-4 lg:mt-0 px-2 lg:px-0">
                    <div className="flex flex-col items-center lg:items-start mb-4 md:mb-8 self-center lg:self-start gap-2">
                      <div className="inline-flex items-center gap-2 bg-[#facc15] text-black pixel-border border-b-[4px] border-r-[4px] md:border-b-[6px] md:border-r-[6px] px-3 py-1.5 md:px-4 md:py-2 font-serif font-bold text-sm md:text-lg uppercase">
                        <ShieldCheck size={16} className="md:w-5 md:h-5" />
                        Privasi Terjamin
                      </div>
                      <p className="text-xs md:text-sm font-bold bg-white text-black pixel-border px-2 py-1 shadow-[2px_2px_0px_#000] max-w-sm text-center lg:text-left">
                        Enkripsi end-to-end langsung dari protokol WhatsApp resmi.
                      </p>
                    </div>
                    
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-serif font-bold leading-tight mb-4 md:mb-6 uppercase text-black drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000]">
                      MILIKI BOT WHATSAPP <br/> <span className="text-blue-600">ANDA SEKARANG.</span>
                    </h1>
                  </div>

                  <div className="bg-[#AED6F1] pixel-border p-4 md:p-8 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] md:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-center w-full min-h-[350px] md:min-h-[450px] relative overflow-hidden">
                    <div 
                      className="absolute inset-0 z-0 bg-cover bg-center bg-no-repeat pointer-events-none transition-opacity duration-500"
                      style={{ backgroundImage: `url(${mascotImages[currentMascotIndex]})` }}
                    />
                    <div className="relative z-10 w-full flex flex-col justify-center">
                    {pairingCode ? (
                      <div className="space-y-4 md:space-y-6 text-center w-full">
                        <div className="space-y-3 md:space-y-4">
                          <label className="font-serif text-sm md:text-xl font-bold uppercase block bg-black text-white py-1">
                            KODE RAHASIA
                          </label>
                          <div className="bg-gray-200 pixel-border p-4 sm:p-6 md:p-8 py-6 sm:py-8 md:py-10 flex flex-col items-center gap-4 md:gap-6 relative shadow-inner overflow-hidden">
                            <span className="font-serif text-4xl sm:text-5xl md:text-6xl tracking-widest md:tracking-[8px] text-black font-bold break-all whitespace-pre-wrap">
                              {pairingCode}
                            </span>
                            <button onClick={copyToClipboard} className="pixel-button bg-[#4ade80] text-black px-4 py-3 md:px-6 md:py-3 text-sm md:text-xl w-full flex items-center justify-center gap-2">
                              {copied ? <CheckCircle2 size={18} className="md:w-6 md:h-6" /> : <Copy size={18} className="md:w-6 md:h-6" />} 
                              {copied ? 'DISALIN!' : 'SALIN KODE'}
                            </button>
                          </div>
                        </div>

                        <div className="text-left space-y-2 md:space-y-3 bg-[#facc15] pixel-border p-3 md:p-4 text-black">
                          <span className="font-serif text-sm md:text-lg font-bold uppercase block border-b-4 border-black pb-2 mb-2 md:mb-4">
                            CARA PAKAI
                          </span>
                          <ol className="text-sm md:text-lg lg:text-xl space-y-2 font-bold pl-4 md:pl-6 list-decimal">
                            <li>Buka WA Ponsel &gt; Perangkat Tertaut</li>
                            <li>Pilih 'Tautkan Perangkat'</li>
                            <li>Pilih 'Tautkan dg Nomor Telepon'</li>
                          </ol>
                        </div>

                        <button onClick={handleCancelPairing} disabled={loading} className="pixel-button bg-red-400 text-black px-3 py-3 md:py-4 mt-2 text-xs sm:text-sm md:text-lg w-full flex items-center justify-center gap-1 md:gap-2">
                          {loading ? <Loader2 size={16} className="animate-spin md:w-5 md:h-5" /> : <RefreshCw size={16} className="shrink-0" />} BATAL & GANTI NOMOR PENGIRIM
                        </button>
                      </div>
                    ) : botStatus.sessionExists ? (
                      <div className="space-y-6 text-center py-6 md:py-8">
                        <div className={`w-16 h-16 md:w-24 md:h-24 border-4 border-black flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-[4px_4px_0px_0px_#000] ${botStatus.connected ? 'bg-[#4ade80]' : 'bg-gray-200'}`}>
                          {botStatus.connected ? <CheckCircle2 size={32} className="md:w-12 md:h-12" /> : <Loader2 size={32} className="animate-spin md:w-12 md:h-12" />}
                        </div>
                        
                        <div className="bg-white pixel-border p-3 md:p-4 text-black">
                          <h2 className="text-xl md:text-2xl font-serif font-bold mb-1 md:mb-2 uppercase">
                            {botStatus.connected ? 'BERHASIL' : 'MENGHUBUNGKAN...'}
                          </h2>
                          <p className="text-sm md:text-lg font-bold">
                            {botStatus.connected 
                              ? 'WhatsApp anda sukses terhubung dengan bot.'
                              : 'Bot terdeteksi sedang menyambung ulang ke jaringan...'}
                          </p>
                        </div>

                        <div className="pt-6 md:pt-8 flex flex-col gap-3 md:gap-4">
                          {(!botStatus.connected) && (
                            <>
                              <button onClick={handleReconnect} disabled={loading} className="pixel-button bg-[#facc15] text-black py-3 md:py-4 text-sm md:text-lg w-full flex justify-center items-center gap-2">
                                {loading ? <Loader2 size={16} className="animate-spin md:w-5 md:h-5" /> : <RefreshCw size={16} className="md:w-5 md:h-5" />} PAKSA HUBUNGKAN
                              </button>
                              <button onClick={handleLogout} disabled={loading} className="pixel-button bg-red-400 text-white py-3 md:py-4 text-sm md:text-lg w-full flex justify-center items-center gap-2">
                                {loading ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={18} />} HANCURKAN SESI & LOGOUT
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={handlePair} className="space-y-6 md:space-y-8 w-full">
                        <div className="bg-black text-white p-3 md:p-4 pixel-border">
                          <h2 className="text-lg md:text-2xl font-serif font-bold uppercase mb-1 md:mb-2 italic">
                            MASUKKAN NOMOR
                          </h2>
                        </div>
                        
                        <div className="space-y-4 md:space-y-6">

                                <div className="relative">
                                    <Phone className="absolute left-3 md:left-4 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5 md:w-6 md:h-6" />
                                    <input
                                    type={isPhoneNumberVisible ? "tel" : "password"}
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    name="phone-number-field"
                                    placeholder={placeholderText}
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value.replace(/[^0-9]/g, ''))}
                                    className={`w-full bg-white text-black placeholder:text-gray-500 border-4 border-black p-3 pl-10 md:p-4 md:pl-14 text-lg sm:text-xl md:text-2xl font-bold outline-none focus:bg-yellow-100 transition-colors shadow-[4px_4px_0px_0px_#000] ${!isPhoneNumberVisible ? 'mask-input' : ''}`}
                                    required
                                    disabled={loading}
                                    autoFocus
                                    autoComplete="one-time-code"
                                    data-lpignore="true"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setIsPhoneNumberVisible(!isPhoneNumberVisible)}
                                        className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-black"
                                    >
                                        {isPhoneNumberVisible ? <EyeOff size={20}/> : <Eye size={20}/>}
                                    </button>
                                </div>

                                <div className="flex justify-center w-full overflow-hidden mt-4 mb-2">
                                  <div className="transform scale-90 md:scale-100 origin-center">
                                    <ReCAPTCHA
                                      sitekey="6LdcWOcsAAAAAL42mYR87Wzi0lKm_c3rPhvR7Kje"
                                      onChange={(val) => setIsVerified(!!val)}
                                    />
                                  </div>
                                </div>

                                <div className="flex flex-col gap-3">
                                  <button
                                    type="submit"
                                    disabled={loading || !phoneNumber || !isVerified}
                                    className="pixel-button bg-[#3b82f6] disabled:bg-gray-400 text-white py-3 md:py-4 text-lg md:text-2xl w-full flex items-center justify-center gap-2 md:gap-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
                                  >
                                    {loading ? <Loader2 size={20} className="animate-spin md:w-6 md:h-6" /> : 'GET PAIRING CODE'}
                                  </button>
                                </div>
                          
                          {error && (
                            <div className="flex items-start gap-2 md:gap-4 text-black bg-red-400 pixel-border p-3 md:p-4 text-sm md:text-lg font-bold shadow-[4px_4px_0px_0px_#000]">
                              <AlertTriangle size={20} className="shrink-0 mt-0.5 md:w-6 md:h-6" />
                              <p>{error}</p>
                            </div>
                          )}
                        </div>
                      </form>
                    )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'settings' && (
              <motion.div key="settings" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6 md:space-y-8 max-w-3xl mx-auto w-full">
                <div>
                  <h1 className="text-3xl md:text-4xl font-serif font-bold mb-2 uppercase drop-shadow-[2px_2px_0px_#fff,4px_4px_0px_#000] break-words">PENGATURAN MESIN</h1>
                  <p className="text-sm md:text-xl font-bold bg-black text-white inline-block px-2 py-1">Tweak modifikasi inti sistem bot.</p>
                </div>
                
                {configLoading && !config ? (
                  <div className="flex items-center justify-center py-10 md:py-20 bg-white pixel-border shadow-[4px_4px_0px_0px_#000] md:shadow-[8px_8px_0px_0px_#000]">
                    <Loader2 size={32} className="animate-spin text-black md:w-12 md:h-12" />
                  </div>
                ) : (
                  <div className="bg-white border-4 border-black shadow-[8px_8px_0px_0px_#000] w-full flex flex-col">
                    <div className="bg-[#FF90E8] border-b-4 border-black p-4 md:p-6 flex items-center gap-4">
                      <Settings size={32} className="text-black" />
                      <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight">Konfigurasi Sistem</h2>
                    </div>

                    <div className="p-4 md:p-6 bg-white overflow-y-auto max-h-[70vh] space-y-8 custom-scrollbar">
                      
                      {/* SECTION: API KEYS */}
                      <div className="bg-[#4ade80] border-4 border-black p-4 md:p-6 shadow-[4px_4px_0px_0px_#000]">
                        <div className="flex items-center gap-3 border-b-4 border-black pb-3 mb-4">
                          <Key size={24} className="text-black" />
                          <h3 className="text-xl md:text-2xl font-black uppercase tracking-tighter">Integrasi Token</h3>
                        </div>
                        
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm font-black uppercase text-black bg-white border-2 border-black px-2 py-1 inline-block">Vercel Token</label>
                            <input
                              type="password"
                              placeholder="Masukkan token deploy Vercel..."
                              value={config?.vercelToken || ''}
                              onChange={(e) => setConfig({ ...config, vercelToken: e.target.value })}
                              className="w-full bg-white border-4 border-black p-3 font-bold focus:bg-green-100 outline-none font-mono tracking-widest shadow-[4px_4px_0px_0px_#000] active:shadow-none transition-all"
                            />
                            <div className="bg-white/70 border-l-4 border-black p-2 inline-block mt-2">
                              <p className="text-xs font-bold text-gray-800">Dibutuhkan untuk menjalankan perintah <code className="bg-gray-200 px-1">.deploy</code></p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm font-black uppercase text-black bg-white border-2 border-black px-2 py-1 inline-block">Nevapedia API Key</label>
                            <input
                              type="password"
                              placeholder="Masukkan Nevapedia API Key..."
                              value={config?.nevapediaApiKey || ''}
                              onChange={(e) => setConfig({ ...config, nevapediaApiKey: e.target.value })}
                              className="w-full bg-white border-4 border-black p-3 font-bold focus:bg-green-100 outline-none font-mono tracking-widest shadow-[4px_4px_0px_0px_#000] active:shadow-none transition-all"
                            />
                            <div className="bg-white/70 border-l-4 border-black p-2 inline-block mt-2">
                              <p className="text-xs font-bold text-gray-800">Dibutuhkan untuk menjalankan perintah pembayaran/payment <code className="bg-gray-200 px-1">.pay</code> atau <code className="bg-gray-200 px-1">.payment</code></p>
                            </div>
                          </div>
                        </div>
                      </div>
                      
                    </div>
                    
                    <div className="bg-[#ff4911] p-4 md:p-6 border-t-4 border-black flex flex-col md:flex-row justify-between items-center gap-4 w-full">
                       <p className="text-white font-bold text-sm bg-black px-3 py-2">Pastikan data sudah benar.</p>
                       <button
                        onClick={saveConfig}
                        disabled={configLoading}
                        className="bg-[#facc15] border-4 border-black text-black py-3 px-8 text-xl font-black flex items-center justify-center gap-3 w-full md:w-auto hover:bg-[#bef264] hover:-translate-y-1 hover:shadow-[6px_6px_0px_0px_#000] active:translate-y-0 active:translate-x-0 active:shadow-[2px_2px_0px_0px_#000] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {configLoading ? <Loader2 size={24} className="animate-spin" /> : <Save size={24} />} 
                        <span>SIMPAN KONFIGURASI</span>
                      </button>
                    </div>
                  </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>

        {/* Follow Popup Notification */}
        <AnimatePresence>
          {showFollowPopup && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                className="bg-[#AED6F1] border-4 border-black p-6 w-full max-w-sm shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] relative flex flex-col justify-center"
              >
                <button 
                  onClick={() => {
                    setShowFollowPopup(false);
                    if (notificationAudioRef.current) {
                      notificationAudioRef.current.currentTime = 0;
                      notificationAudioRef.current.play().catch(e => console.error("Audio play failed:", e));
                    }
                  }}
                  className="absolute -top-3 -right-3 z-10 bg-red-500 border-4 border-black p-1 hover:bg-red-600 transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-1 active:translate-y-1"
                >
                  <X size={24} className="text-black stroke-[3]" />
                </button>
                <h2 className="text-xl font-black uppercase mb-4 text-center tracking-tight border-b-4 border-black pb-2">Notifikasi</h2>
                
                <div className="relative w-full aspect-square border-4 border-black bg-white mb-6 overflow-hidden flex justify-center items-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                  <div 
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-opacity duration-500"
                    style={{ backgroundImage: `url(${mascotImages[currentMascotIndex]})` }}
                  />
                </div>
                
                <p className="text-center font-bold text-sm mb-6 bg-white border-2 border-dashed border-black p-3">
                  Follow saluran WhatsApp untuk info update CMNTY BOT biar ga ketinggalan informasi.
                </p>
                
                <a 
                  href="https://whatsapp.com/channel/0029VbCox0f17Emr10Bdlj0V"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setShowFollowPopup(false)}
                  className="w-full bg-[#4ade80] text-black border-4 border-black p-3 font-black uppercase flex justify-center items-center gap-2 hover:bg-[#38bdf8] transition-colors shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-y-1 hover:translate-x-1 hover:shadow-none"
                >
                  Follow Saluran
                </a>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    );
  }
