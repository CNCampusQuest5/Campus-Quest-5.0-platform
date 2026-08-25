import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
const DEFAULT_BACKEND = 'https://campus-quest-backend-production-8cee.up.railway.app';
const BACKEND = import.meta.env?.VITE_API_URL || DEFAULT_BACKEND;
const API_URL = `${BACKEND}/admin`;
const DEMO_URL = `${BACKEND}/demo`;
const SOCKET_URL = import.meta.env?.VITE_SOCKET_URL || BACKEND;
export default function App() {
    const [teams, setTeams] = useState([]);
    const [submissions, setSubmissions] = useState([]);
    const [violations, setViolations] = useState([]);
    const [powerups, setPowerups] = useState([]);
    const [analytics, setAnalytics] = useState(null);
    const [contestStatus, setContestStatus] = useState('Unknown');
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('monitoring');
    const [demoModeEnabled, setDemoModeEnabled] = useState(false);
    const [demoTeams, setDemoTeams] = useState([]);
    const [selectedDemoTeam, setSelectedDemoTeam] = useState('');
    const [demoStatus, setDemoStatus] = useState(null);
    const [demoLoading, setDemoLoading] = useState(null);
    const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem('cq_admin_token') || null);
    const [loginInput, setLoginInput] = useState('');
    const [loginError, setLoginError] = useState(null);
    const [loginLoading, setLoginLoading] = useState(false);
    // Setup Axios globally when token is set
    useEffect(() => {
        if (adminToken) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${adminToken}`;
            sessionStorage.setItem('cq_admin_token', adminToken); // M2: persist
        }
    }, [adminToken]);
    // Fetch initial state
    const fetchData = useCallback(async () => {
        try {
            const teamsRes = await axios.get(`${BACKEND}/admin/teams`);
            setTeams(teamsRes.data);
            const subsRes = await axios.get(`${BACKEND}/admin/submissions`);
            setSubmissions(subsRes.data);
            const analyticsRes = await axios.get(`${BACKEND}/admin/analytics`);
            setAnalytics(analyticsRes.data);
            const statusRes = await axios.get(`${BACKEND}/admin/contest-status`);
            setContestStatus(statusRes.data?.status || 'NOT_STARTED');
        }
        catch (err) {
            console.error('Failed to load initial admin data:', err);
        }
    }, []);
    useEffect(() => {
        if (!adminToken)
            return;
        fetchData();
        // Check demo mode status
        axios.get(`${DEMO_URL}/status`).then(res => {
            setDemoModeEnabled(res.data.enabled);
        }).catch(() => { });
        // Load both demo teams AND test teams into the selector
        Promise.all([
            axios.get(`${DEMO_URL}/teams`).catch(() => ({ data: [] })),
            axios.get(`${BACKEND}/api/test-teams`).catch(() => ({ data: [] })),
        ]).then(([demoRes, testRes]) => {
            // Test teams come first (these are the real login accounts)
            const testList = testRes.data.map((t) => ({ id: t.id, name: `${t.name} (test)`, email: '' }));
            const demoList = demoRes.data;
            const merged = [...testList, ...demoList];
            setDemoTeams(merged);
            if (merged.length > 0)
                setSelectedDemoTeam(merged[0].id);
        });
        // Connect admin to live WebSocket updates
        const socket = io(SOCKET_URL, {
            auth: { adminSecret: adminToken }
        });
        socket.on('connect', () => {
            console.log('[Admin Socket] Connected to stream');
            socket.emit('join:admin');
            fetchData(); // pull fresh data on connection / reconnection
        });
        socket.on('admin:violation_alert', (alert) => {
            setViolations(prev => [
                { teamId: alert.teamId, type: alert.type, timestamp: new Date().toLocaleTimeString(), violationCount: alert.violationCount },
                ...prev.slice(0, 49),
            ]);
            fetchData();
        });
        socket.on('admin:powerup_used', (usage) => {
            setPowerups(prev => [
                { teamId: usage.teamId, type: usage.type, timestamp: new Date().toLocaleTimeString() },
                ...prev.slice(0, 49),
            ]);
            fetchData();
        });
        socket.on('submit:result', () => { fetchData(); });
        socket.on('demo:leaderboard_updated', () => { fetchData(); });
        socket.on('demo:contest_reset', () => { fetchData(); setContestStatus('NOT_STARTED'); });
        // WARN-1 fix: handle lobby state — admin sees LOBBY before RUNNING
        socket.on('contest:lobby_started', () => setContestStatus('LOBBY'));
        socket.on('contest:started', () => setContestStatus('RUNNING'));
        socket.on('contest:resumed', () => setContestStatus('RUNNING'));
        socket.on('contest:paused', () => setContestStatus('PAUSED'));
        socket.on('contest:ended', () => setContestStatus('ENDED'));
        return () => { socket.disconnect(); };
    }, [fetchData, adminToken]);
    const handleLogin = async (e) => {
        e.preventDefault();
        const secret = loginInput.trim();
        if (!secret) {
            setLoginError('Secret required');
            return;
        }
        setLoginLoading(true);
        setLoginError(null);
        try {
            // POST to /admin/login — backend validates the secret and returns 401 if wrong.
            // This is the canonical auth flow; the secret itself is used as the bearer token.
            await axios.post(`${API_URL}/login`, { secret });
            setAdminToken(secret);
        }
        catch (err) {
            if (err.response?.status === 401) {
                setLoginError('Invalid admin secret. Access denied.');
            }
            else {
                setLoginError('Backend unreachable — is the server running?');
            }
        }
        finally {
            setLoginLoading(false);
        }
    };
    if (!adminToken) {
        return (_jsx("div", { className: "min-h-screen bg-gray-900 flex items-center justify-center text-white", children: _jsxs("form", { onSubmit: handleLogin, className: "bg-gray-800 p-8 rounded-lg shadow-xl w-96", children: [_jsx("h2", { className: "text-2xl font-bold text-red-500 mb-6 text-center", children: "Admin Access" }), _jsxs("div", { className: "mb-4", children: [_jsx("label", { className: "block text-gray-400 text-sm mb-2", children: "Admin Secret" }), _jsx("input", { type: "password", className: "w-full bg-gray-700 text-white rounded px-3 py-2", value: loginInput, onChange: (e) => setLoginInput(e.target.value) })] }), loginError && _jsx("div", { className: "text-red-500 text-sm mb-4", children: loginError }), _jsx("button", { type: "submit", disabled: loginLoading, className: "w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded", children: loginLoading ? 'Verifying…' : 'Login' })] }) }));
    }
    const handleAction = async (action) => {
        try {
            setError(null);
            let endpoint = '';
            if (action === 'start')
                endpoint = '/start-contest';
            else if (action === 'begin')
                endpoint = '/begin-coding';
            else if (action === 'pause')
                endpoint = '/pause-contest';
            else if (action === 'resume')
                endpoint = '/resume-contest';
            else if (action === 'stop')
                endpoint = '/emergency-stop';
            else if (action === 'reset')
                endpoint = '/reset-contest';
            await axios.post(`${API_URL}${endpoint}`);
            // Start transitions to LOBBY, begin transitions to RUNNING directly
            setContestStatus(action === 'stop' ? 'ENDED' : action === 'reset' ? 'NOT_STARTED' : action === 'start' ? 'LOBBY' : action === 'begin' || action === 'resume' ? 'RUNNING' : 'PAUSED');
            fetchData();
        }
        catch (err) {
            setError(err.response?.data?.error || err.message || 'An error occurred');
        }
    };
    const handleResumeTeam = async (teamId) => {
        try {
            setError(null);
            await axios.post(`${API_URL}/resume-team`, { teamId });
            fetchData();
        }
        catch (err) {
            setError(err.response?.data?.error || err.message || 'Failed to resume team');
        }
    };
    // ── Demo helpers ────────────────────────────────────────────────────────────
    const demoAction = async (endpoint, payload = {}, label) => {
        setDemoLoading(label);
        setDemoStatus(null);
        try {
            const res = await axios.post(`${DEMO_URL}/${endpoint}`, payload);
            setDemoStatus(`✓ ${label}: ${res.data.message || 'Done'}`);
            fetchData();
        }
        catch (err) {
            setDemoStatus(`✗ ${label} failed: ${err.response?.data?.message || err.message}`);
        }
        finally {
            setDemoLoading(null);
        }
    };
    const getVerdictBadge = (verdict) => {
        switch (verdict) {
            case 'AC': return 'bg-green-100 text-green-700 border-green-300';
            case 'CE': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            default: return 'bg-red-100 text-red-700 border-red-300';
        }
    };
    const DemoButton = ({ label, icon, onClick, color = 'slate', }) => {
        const colorMap = {
            green: 'bg-green-700 hover:bg-green-600 border-green-400',
            blue: 'bg-sky-700 hover:bg-sky-600 border-sky-400',
            amber: 'bg-amber-700 hover:bg-amber-600 border-amber-400',
            red: 'bg-red-700 hover:bg-red-600 border-red-400',
            purple: 'bg-purple-700 hover:bg-purple-600 border-purple-400',
            slate: 'bg-slate-700 hover:bg-slate-600 border-slate-500',
        };
        const cls = colorMap[color] || colorMap.slate;
        return (_jsxs("button", { onClick: onClick, disabled: demoLoading !== null, className: `flex flex-col items-center gap-1.5 px-3 py-3 ${cls} border-2 text-white font-mono text-[10px] font-bold uppercase tracking-wider transition-all shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed min-w-[100px]`, id: `demo-btn-${label.toLowerCase().replace(/\s+/g, '-')}`, children: [_jsx("span", { className: "text-xl", children: icon }), _jsx("span", { className: "leading-tight text-center", children: label }), demoLoading === label && _jsx("span", { className: "text-[8px] animate-pulse text-yellow-300", children: "Working\u2026" })] }));
    };
    return (_jsx("div", { className: "min-h-screen bg-slate-900 text-slate-100 p-6 font-sans", children: _jsxs("div", { className: "max-w-7xl mx-auto space-y-6", children: [_jsxs("header", { className: "bg-slate-800 border-2 border-slate-700 p-5 rounded-none flex items-center justify-between shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsxs("div", { children: [_jsx("h1", { className: "text-2xl font-black tracking-widest text-red-500 uppercase", children: "\uD83D\uDD77 SPIDER-VISION ADMIN CONSOLE" }), _jsx("p", { className: "text-xs text-slate-400 font-mono mt-1", children: "REAL-TIME MULTIVERSE CONTEST STATE TELEMETRY" })] }), _jsxs("div", { className: "flex items-center gap-4", children: [demoModeEnabled && (_jsx("div", { className: "bg-yellow-900/60 border border-yellow-500 px-3 py-1.5 text-xs font-mono text-yellow-400 animate-pulse", children: "\u26A0 DEMO MODE ACTIVE" })), _jsxs("div", { className: "bg-slate-950 px-4 py-2 border border-slate-700 text-xs font-mono", children: ["CONTEST STATUS: ", _jsx("span", { className: `font-bold ${contestStatus === 'RUNNING' ? 'text-green-400' : 'text-red-500 animate-pulse'}`, children: contestStatus.toUpperCase() })] })] })] }), _jsxs("section", { className: "bg-slate-800 border-2 border-slate-700 p-5 rounded-none shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsxs("div", { className: "flex justify-between items-center mb-4", children: [_jsx("h2", { className: "text-sm font-black tracking-widest text-slate-300 uppercase", children: "CONTEST CONTROLS" }), error && _jsxs("span", { className: "text-xs text-red-400 font-mono font-bold", children: ["\u26A0\uFE0F ERROR: ", error] })] }), _jsxs("div", { className: "flex flex-wrap gap-4", children: [_jsx("button", { onClick: () => handleAction('start'), className: "px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none", children: "Start Lobby" }), _jsx("button", { onClick: () => handleAction('begin'), className: "px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-black font-mono text-xs font-black uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none animate-pulse", children: "\uD83D\uDE80 Begin Coding" }), _jsx("button", { onClick: () => handleAction('pause'), className: "px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none", children: "Pause Contest" }), _jsx("button", { onClick: () => handleAction('resume'), className: "px-5 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none", children: "Resume Contest" }), _jsx("button", { onClick: () => handleAction('stop'), className: "px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none", children: "\u26A0\uFE0F EMERGENCY STOP" }), _jsx("button", { onClick: () => handleAction('reset'), className: "px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-mono text-xs font-bold uppercase border-2 border-black shadow-[2px_2px_0_#000] active:translate-y-0.5 active:shadow-none", children: "\uD83D\uDD04 RESET ALL SCORES" })] })] }), _jsxs("div", { className: "flex gap-4 border-b-2 border-slate-700 pb-2", children: [['monitoring', 'leaderboard', 'analytics'].map(tab => (_jsx("button", { onClick: () => setActiveTab(tab), className: `px-4 py-2 font-mono text-xs font-bold uppercase border-2 transition-all ${activeTab === tab ? 'bg-red-500 text-white border-black shadow-[2px_2px_0_#000]' : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'}`, children: tab === 'monitoring' ? 'Operations Monitoring' : tab === 'leaderboard' ? 'Championship Leaderboard' : 'Analytics & Telemetry' }, tab))), _jsx("button", { onClick: () => setActiveTab('demo'), className: `px-4 py-2 font-mono text-xs font-bold uppercase border-2 transition-all ${activeTab === 'demo' ? 'bg-yellow-500 text-black border-black shadow-[2px_2px_0_#000]' : 'bg-yellow-900/40 text-yellow-400 border-yellow-700 hover:text-yellow-300'}`, id: "demo-controls-tab", children: "\u26A1 DEMO CONTROLS" })] }), activeTab === 'monitoring' && (_jsxs("div", { className: "grid grid-cols-1 lg:grid-cols-3 gap-6", children: [_jsxs("div", { className: "lg:col-span-2 space-y-6", children: [_jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-slate-300 uppercase mb-4", children: "LIVE TEAMS MONITORING" }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-4", children: teams.map(t => (_jsxs("div", { className: `border-2 p-4 bg-slate-900 shadow-[2px_2px_0_0_rgba(0,0,0,1)] flex flex-col justify-between ${t.isDisqualified ? 'border-red-600 bg-red-950/20' : t.isPaused ? 'border-amber-500 bg-amber-950/20' : 'border-slate-700'}`, children: [_jsxs("div", { children: [_jsxs("div", { className: "flex items-center justify-between border-b border-slate-800 pb-2 mb-2", children: [_jsx("span", { className: "font-bold text-sm tracking-wide text-white", children: t.name }), _jsx("span", { className: `font-mono text-[9px] font-bold px-1.5 py-0.5 border ${t.isDisqualified ? 'bg-red-900 border-red-500 text-white' : t.isPaused ? 'bg-amber-900 border-amber-500 text-white' : 'bg-green-900 border-green-500 text-white'}`, children: t.isDisqualified ? 'DQ' : t.isPaused ? 'PAUSED' : 'ACTIVE' })] }), _jsxs("div", { className: "grid grid-cols-2 gap-2 text-xs font-mono text-slate-400 mt-2", children: [_jsxs("div", { children: ["Solved: ", _jsx("span", { className: "text-white font-bold", children: t.solvedCount })] }), _jsxs("div", { children: ["Hint Stage: ", _jsx("span", { className: "text-purple-400 font-bold", children: t.hintStage })] }), _jsxs("div", { children: ["Strikes: ", _jsxs("span", { className: `font-bold ${t.violationCount > 2 ? 'text-red-400 animate-pulse' : 'text-slate-200'}`, children: [t.violationCount, "/5"] })] }), _jsxs("div", { children: ["Active: ", _jsx("span", { className: "text-sky-400 font-bold", children: t.currentProblemId.substring(0, 10) })] })] })] }), _jsx("div", { className: "mt-4 flex gap-2 justify-end", children: t.isPaused && !t.isDisqualified && (_jsx("button", { onClick: () => handleResumeTeam(t.id), className: "px-3 py-1 bg-green-600 hover:bg-green-700 text-white font-mono text-[10px] font-bold uppercase border border-black shadow-[1px_1px_0_#000] active:translate-y-0.5 active:shadow-none", children: "Resume Team" })) })] }, t.id))) })] }), _jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-slate-300 uppercase mb-4", children: "LIVE SUBMISSIONS FEED" }), _jsx("div", { className: "space-y-3.5 max-h-[300px] overflow-y-auto pr-1", children: submissions.map(sub => (_jsxs("div", { className: "border border-slate-700 bg-slate-900 p-3 flex justify-between items-center font-mono text-xs", children: [_jsxs("div", { children: [_jsxs("div", { className: "flex gap-2", children: [_jsx("span", { className: "font-bold text-white", children: sub.teamId }), _jsx("span", { className: "text-slate-500", children: "submitted" }), _jsx("span", { className: "text-sky-400 font-bold", children: sub.problemId })] }), _jsxs("div", { className: "text-[10px] text-slate-500 mt-1", children: ["Lang: ", sub.language, " \u2022 ", new Date(sub.createdAt).toLocaleTimeString()] })] }), _jsxs("div", { className: "flex gap-3 items-center", children: [_jsxs("span", { className: "text-[10px] text-slate-400", children: [sub.runtimeMs, "ms"] }), _jsx("span", { className: `border px-1.5 py-0.5 text-[10px] font-bold ${getVerdictBadge(sub.verdict)}`, children: sub.verdict })] })] }, sub.id))) })] })] }), _jsxs("div", { className: "space-y-6", children: [_jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-red-500 uppercase mb-4 flex items-center gap-2", children: "\u26A0\uFE0F CHEAT DETECT ALERTS" }), _jsxs("div", { className: "space-y-3 max-h-[250px] overflow-y-auto", children: [violations.map((v, i) => (_jsxs("div", { className: "border-l-4 border-red-500 bg-red-950/20 p-2.5 font-mono text-[11px]", children: [_jsxs("div", { className: "flex justify-between font-bold text-red-400", children: [_jsx("span", { children: v.teamId }), _jsx("span", { children: v.timestamp })] }), _jsxs("p", { className: "text-slate-300 mt-1 uppercase text-[10px]", children: ["VIOLATION: ", v.type] }), v.violationCount && _jsxs("p", { className: "text-slate-400 mt-0.5 text-[9px]", children: ["Strike Count: ", v.violationCount, "/5"] })] }, i))), violations.length === 0 && _jsx("div", { className: "text-center py-6 text-zinc-500 font-mono text-xs", children: "No violations detected." })] })] }), _jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-yellow-500 uppercase mb-4", children: "\u26A1 POWERUP CONSUMPTION LOG" }), _jsxs("div", { className: "space-y-3 max-h-[250px] overflow-y-auto", children: [powerups.map((p, i) => (_jsxs("div", { className: "border-l-4 border-yellow-500 bg-yellow-950/10 p-2.5 font-mono text-[11px]", children: [_jsxs("div", { className: "flex justify-between font-bold text-yellow-500", children: [_jsx("span", { children: p.teamId }), _jsx("span", { children: p.timestamp })] }), _jsxs("p", { className: "text-slate-300 mt-1 uppercase text-[10px]", children: ["Activated: ", p.type] })] }, i))), powerups.length === 0 && _jsx("div", { className: "text-center py-6 text-zinc-500 font-mono text-xs", children: "No powerups activated." })] })] })] })] })), activeTab === 'leaderboard' && (_jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-slate-300 uppercase mb-4", children: "CHAMPIONSHIP LEADERBOARD" }), _jsx("div", { className: "overflow-x-auto", children: _jsxs("table", { className: "w-full font-mono text-xs border-collapse", children: [_jsx("thead", { children: _jsxs("tr", { className: "border-b-2 border-slate-700 text-slate-400 text-left", children: [_jsx("th", { className: "pb-3 font-bold uppercase", children: "Rank" }), _jsx("th", { className: "pb-3 font-bold uppercase", children: "Team Name" }), _jsx("th", { className: "pb-3 font-bold uppercase text-center", children: "Solves / Bypasses" }), _jsx("th", { className: "pb-3 font-bold uppercase text-center", children: "Submissions" }), _jsx("th", { className: "pb-3 font-bold uppercase text-center", children: "Penalty" }), _jsx("th", { className: "pb-3 font-bold uppercase text-right", children: "Current Activity" })] }) }), _jsx("tbody", { children: teams
                                            .slice()
                                            .sort((a, b) => b.solvedCount - a.solvedCount || (a.penalty ?? 0) - (b.penalty ?? 0))
                                            .map((t, idx) => (_jsxs("tr", { className: "border-b border-slate-800/60 hover:bg-slate-900/40 transition-colors", children: [_jsxs("td", { className: "py-3.5 font-black text-slate-400 text-sm", children: ["#", idx + 1] }), _jsx("td", { className: "py-3.5 font-bold text-white text-sm", children: t.name }), _jsxs("td", { className: "py-3.5 text-center font-black text-sm", children: [_jsx("span", { className: "text-green-400", children: t.legitimateSolvedCount ?? t.solvedCount }), _jsx("span", { className: "text-slate-500 mx-1", children: "/" }), _jsx("span", { className: "text-orange-400", children: t.bypassedCount ?? 0 })] }), _jsx("td", { className: "py-3.5 text-center text-slate-300", children: t.submissionCount || 0 }), _jsxs("td", { className: "py-3.5 text-center text-red-400 font-bold", children: [t.penalty || 0, " pts"] }), _jsx("td", { className: "py-3.5 text-right font-semibold text-slate-400", children: t.isDisqualified ? _jsx("span", { className: "text-red-500 font-bold uppercase", children: "Disqualified" })
                                                        : t.isPaused ? _jsx("span", { className: "text-amber-500 font-bold uppercase", children: "Locked Out" })
                                                            : _jsx("span", { className: "text-sky-400", children: t.latestVerdict !== 'none' ? `Verdict: ${t.latestVerdict} (${t.currentProblemId.substring(0, 10)})` : 'Active' }) })] }, t.id))) })] }) })] })), activeTab === 'analytics' && analytics && (_jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-6 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-slate-300 uppercase mb-4", children: "CONTEST ANALYTICS & TELEMETRY" }), _jsxs("div", { className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6", children: [_jsxs("div", { className: "bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1", children: "Missions" }), _jsxs("div", { className: "space-y-3 font-mono text-xs", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Most Solved" }), _jsx("span", { className: "text-green-400 font-bold truncate max-w-[120px] ml-2", children: analytics.mostSolvedQuestion })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Most Bypassed" }), _jsx("span", { className: "text-yellow-400 font-bold truncate max-w-[120px] ml-2", children: analytics.mostBypassedQuestion })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Most Failed" }), _jsx("span", { className: "text-red-400 font-bold truncate max-w-[120px] ml-2", children: analytics.mostFailedQuestion })] })] })] }), _jsxs("div", { className: "bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1", children: "Performance" }), _jsxs("div", { className: "space-y-3 font-mono text-xs", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Avg Runtime" }), _jsxs("span", { className: "text-sky-400 font-bold", children: [analytics.averageRuntime, " ms"] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Avg Memory" }), _jsxs("span", { className: "text-purple-400 font-bold", children: [analytics.averageMemory, " KB"] })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Fastest Solve" }), _jsxs("span", { className: "text-white font-bold", children: [analytics.fastestSolve, " ms"] })] })] })] }), _jsxs("div", { className: "bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1", children: "Engagement" }), _jsxs("div", { className: "space-y-3 font-mono text-xs", children: [_jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Avg Attempts" }), _jsx("span", { className: "text-white font-bold", children: analytics.averageAttempts })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Spider-Sense Used" }), _jsx("span", { className: "text-yellow-400 font-bold", children: analytics.spiderSenseUsage })] }), _jsxs("div", { className: "flex justify-between", children: [_jsx("span", { className: "text-slate-400", children: "Total Powerups" }), _jsx("span", { className: "text-sky-400 font-bold", children: analytics.totalPowerupUsage })] })] })] }), _jsx("div", { className: "bg-slate-900 border border-slate-700 p-4 shadow-[2px_2px_0_0_rgba(0,0,0,1)] flex flex-col justify-between", children: _jsxs("div", { children: [_jsx("h4", { className: "text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3 border-b border-slate-700 pb-1", children: "Security" }), _jsxs("div", { className: "font-mono text-xs text-center py-2", children: [_jsx("div", { className: "text-slate-400 uppercase mb-1", children: "Cheat Alerts" }), _jsx("div", { className: `text-2xl font-black ${analytics.violationCount > 10 ? 'text-red-500 animate-pulse' : 'text-slate-300'}`, children: analytics.violationCount })] })] }) })] })] })), activeTab === 'demo' && (_jsxs("div", { className: "space-y-6", children: [!demoModeEnabled && (_jsxs("div", { className: "border-2 border-amber-600 bg-amber-950/30 p-5 font-mono text-sm text-amber-400", children: [_jsx("div", { className: "font-black uppercase tracking-widest mb-2", children: "\u26A0\uFE0F DEMO MODE IS DISABLED" }), _jsxs("div", { className: "text-xs text-amber-300", children: ["Set ", _jsx("code", { className: "bg-black/40 px-1.5 py-0.5 rounded", children: "DEMO_MODE=true" }), " in", ' ', _jsx("code", { className: "bg-black/40 px-1.5 py-0.5 rounded", children: "apps/backend/.env" }), " then restart the backend."] })] })), demoStatus && (_jsx("div", { className: `border-2 p-3 font-mono text-xs ${demoStatus.startsWith('✓') ? 'border-green-600 bg-green-950/30 text-green-400' : 'border-red-600 bg-red-950/30 text-red-400'}`, children: demoStatus })), _jsxs("div", { className: "bg-slate-800 border-2 border-yellow-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h3", { className: "text-sm font-black tracking-widest text-yellow-400 uppercase mb-4", children: "\u26A1 DEMO CONTROLS \u2014 FOR PRESENTATIONS ONLY" }), _jsxs("div", { className: "flex items-center gap-4 mb-2", children: [_jsx("label", { className: "text-xs font-mono text-slate-400 uppercase tracking-widest", children: "Active Team:" }), _jsxs("select", { value: selectedDemoTeam, onChange: e => setSelectedDemoTeam(e.target.value), className: "bg-slate-900 border-2 border-slate-600 text-white font-mono text-xs px-3 py-1.5 focus:border-yellow-500 outline-none", id: "demo-team-selector", children: [demoTeams.map(t => (_jsx("option", { value: t.id, children: t.name }, t.id))), teams
                                                    .filter(t => !demoTeams.find(d => d.id === t.id))
                                                    .map(t => (_jsxs("option", { value: t.id, children: [t.name, " (real)"] }, t.id)))] })] }), _jsx("p", { className: "text-[10px] text-slate-500 font-mono", children: "All actions use real backend endpoints. Nothing is faked on the frontend." })] }), _jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-xs font-black tracking-widest text-green-400 uppercase mb-4", children: "\uD83D\uDCC8 PROGRESSION SIMULATOR" }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(DemoButton, { label: "Solve Current", icon: "\u2705", color: "green", onClick: () => demoAction('solve-current', { teamId: selectedDemoTeam }, 'Solve Current') }), _jsx(DemoButton, { label: "Solve Next", icon: "\u23ED", color: "green", onClick: () => demoAction('solve-next', { teamId: selectedDemoTeam }, 'Solve Next') }), _jsx(DemoButton, { label: "Solve ALL", icon: "\uD83D\uDCAF", color: "green", onClick: () => demoAction('solve-all', { teamId: selectedDemoTeam }, 'Solve ALL') }), _jsx(DemoButton, { label: "Reset Team", icon: "\uD83D\uDD04", color: "red", onClick: () => demoAction('reset-team', { teamId: selectedDemoTeam }, 'Reset Team') })] })] }), _jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-xs font-black tracking-widest text-purple-400 uppercase mb-4", children: "\uD83D\uDDFA HINT PROGRESSION" }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(DemoButton, { label: "Unlock Stage 1", icon: "\uD83D\uDD13", color: "purple", onClick: () => demoAction('set-hint-stage', { teamId: selectedDemoTeam, stage: 1 }, 'Unlock Stage 1') }), _jsx(DemoButton, { label: "Unlock Stage 2", icon: "\uD83D\uDD13", color: "purple", onClick: () => demoAction('set-hint-stage', { teamId: selectedDemoTeam, stage: 2 }, 'Unlock Stage 2') }), _jsx(DemoButton, { label: "Unlock Final Hint", icon: "\u26A1", color: "purple", onClick: () => demoAction('set-hint-stage', { teamId: selectedDemoTeam, stage: 3 }, 'Unlock Final Hint') }), _jsx(DemoButton, { label: "Reset Hints", icon: "\uD83D\uDD12", color: "red", onClick: () => demoAction('reset-hints', { teamId: selectedDemoTeam }, 'Reset Hints') })] })] }), _jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-xs font-black tracking-widest text-sky-400 uppercase mb-4", children: "\u2696\uFE0F VERDICT SIMULATOR" }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(DemoButton, { label: "Trigger AC", icon: "\u2705", color: "green", onClick: () => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'AC' }, 'Trigger AC') }), _jsx(DemoButton, { label: "Trigger WA", icon: "\u274C", color: "amber", onClick: () => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'WA' }, 'Trigger WA') }), _jsx(DemoButton, { label: "Trigger CE", icon: "\uD83D\uDD27", color: "amber", onClick: () => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'CE' }, 'Trigger CE') }), _jsx(DemoButton, { label: "Trigger RE", icon: "\uD83D\uDCA5", color: "red", onClick: () => demoAction('trigger-verdict', { teamId: selectedDemoTeam, verdict: 'RE' }, 'Trigger RE') })] })] }), _jsxs("div", { className: "bg-slate-800 border-2 border-slate-700 p-5 shadow-[4px_4px_0_0_rgba(0,0,0,1)]", children: [_jsx("h4", { className: "text-xs font-black tracking-widest text-amber-400 uppercase mb-4", children: "\uD83C\uDFAD DEMO ORCHESTRATION" }), _jsxs("div", { className: "flex flex-wrap gap-3", children: [_jsx(DemoButton, { label: "Populate Leaderboard", icon: "\uD83C\uDFC6", color: "blue", onClick: () => demoAction('populate-leaderboard', {}, 'Populate Leaderboard') }), _jsx(DemoButton, { label: "Generate Activity", icon: "\uD83D\uDCE1", color: "blue", onClick: () => demoAction('generate-activity', {}, 'Generate Activity') }), _jsx(DemoButton, { label: "Simulate Violation", icon: "\u26A0\uFE0F", color: "red", onClick: () => demoAction('simulate-violation', { teamId: selectedDemoTeam, type: 'TAB_SWITCH' }, 'Simulate Violation') }), _jsx(DemoButton, { label: "Trigger Powerup", icon: "\uD83D\uDD77", color: "amber", onClick: () => demoAction('trigger-powerup', { teamId: selectedDemoTeam, type: 'SPIDER_SENSE' }, 'Trigger Powerup') }), _jsx(DemoButton, { label: "Reset Demo Contest", icon: "\uD83D\uDEA8", color: "red", onClick: () => demoAction('reset-contest', {}, 'Reset Demo Contest') })] })] }), _jsx("div", { className: "border-2 border-dashed border-red-800 p-4 text-xs font-mono text-red-700 bg-red-950/10", children: "\u26A0 DEMO MODE \u2014 All actions write to the real database and trigger real Socket.IO events. Set DEMO_MODE=false and restart backend before any real contest." })] }))] }) }));
}
//# sourceMappingURL=App.js.map