import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import loginBg from '../../Assets/LoginPage.png';
import { connectSocket, API_BASE } from '../lib/socket';
// Complete test teams credentials list — shown even if backend fetch is offline
const FALLBACK_TEST_TEAMS = [
    { id: 'test-team-alpha', name: 'Spider Squad', password: 'spider123' },
    { id: 'test-team-beta', name: 'Iron Coders', password: 'iron456' },
    { id: 'test-team-gamma', name: 'Web Slingers', password: 'web789' },
    { id: 'test-team-delta', name: 'Quantum Devs', password: 'quantum000' },
    { id: 'test-team-epsilon', name: 'Cyber Spiders', password: 'cyber101' },
    { id: 'test-team-zeta', name: 'Venom Bytes', password: 'venom2024' },
    { id: 'test-team-eta', name: 'Glitch Hackers', password: 'glitch505' },
    { id: 'test-team-theta', name: 'Prowler Protocol', password: 'prowler77' },
    { id: 'test-team-iota', name: 'Multiverse Ninjas', password: 'multiverse99' },
    { id: 'test-team-kappa', name: 'Oscorp Engineers', password: 'oscorp321' },
    { id: 'test-team-lambda', name: 'Symbiote Script', password: 'symbiote11' },
    { id: 'test-team-mu', name: 'Daily Bugle Devs', password: 'bugle2026' },
    { id: 'test-team-nu', name: 'Sinister Coders', password: 'sinister6' },
    { id: 'test-team-xi', name: 'Stark Industries', password: 'stark3000' },
    { id: 'test-team-omicron', name: 'Web Warriors', password: 'warriors88' },
    { id: 'test-team-pi', name: 'Electro Algorithms', password: 'electro100' },
    { id: 'test-team-rho', name: 'Goblin Innovators', password: 'goblin200' },
    { id: 'test-team-sigma', name: 'Rhino Compilers', password: 'rhino300' },
    { id: 'test-team-tau', name: 'Mysterio Coders', password: 'mysterio400' },
    { id: 'test-team-upsilon', name: 'Kraven Hackers', password: 'kraven500' },
    { id: 'test-team-phi', name: 'Lizard Logic', password: 'lizard600' },
    { id: 'test-team-chi', name: 'Sandman Script', password: 'sandman700' },
    { id: 'test-team-psi', name: 'Vulture Vector', password: 'vulture800' },
    { id: 'test-team-omega', name: 'Carnage Bytes', password: 'carnage900' },
    { id: 'test-team-25', name: 'Kingpin Coders', password: 'kingpin999' },
    { id: 'test-team-26', name: 'Spider-Gwen Guild', password: 'gwen100' },
    { id: 'test-team-27', name: 'Miles Morales Cadre', password: 'miles200' },
    { id: 'test-team-28', name: 'Spider-Man 2099', password: 'miguel300' },
    { id: 'test-team-29', name: 'Spider-Noir Ops', password: 'noir400' },
    { id: 'test-team-30', name: 'Peni Parker Pilots', password: 'spdr500' },
    { id: 'test-team-31', name: 'Spider-Ham Heroes', password: 'ham600' },
    { id: 'test-team-32', name: 'Web-Weaver Cadets', password: 'weaver700' },
    { id: 'test-team-33', name: 'Silk Network', password: 'silk800' },
    { id: 'test-team-34', name: 'Arachne Analysts', password: 'arachne900' },
    { id: 'test-team-35', name: 'Spider-Byte Cyber', password: 'byte1000' },
];
export default function LoginPage({ onLogin }) {
    const [teamName, setTeamName] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [testTeams, setTestTeams] = useState(FALLBACK_TEST_TEAMS);
    // Load test teams from backend and map passwords cleanly
    useEffect(() => {
        fetch(`${API_BASE}/api/test-teams`)
            .then(r => r.ok ? r.json() : null)
            .then((data) => {
            if (data?.length) {
                const merged = data.map(item => {
                    const fallback = FALLBACK_TEST_TEAMS.find(f => f.id === item.id || f.name.toLowerCase() === item.name.toLowerCase());
                    return {
                        id: item.id,
                        name: item.name,
                        password: item.password || fallback?.password || ''
                    };
                });
                setTestTeams(merged);
            }
        })
            .catch(() => { });
    }, []);
    const doLogin = async (name, pwd) => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${API_BASE}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ teamName: name, password: pwd }),
            });
            const data = await res.json();
            if (!res.ok) {
                setError(data.message || 'INVALID CREDENTIALS, HERO!');
                return;
            }
            // Re-attach socket with correct token auth
            connectSocket(data.token);
            onLogin(data.teamId, data.teamName);
        }
        catch {
            setError('BACKEND UNREACHABLE — IS THE SERVER RUNNING?');
        }
        finally {
            setLoading(false);
        }
    };
    const handleSubmit = (e) => {
        e.preventDefault();
        if (!teamName.trim() || !password.trim()) {
            setError('ALL FIELDS REQUIRED, HERO!');
            return;
        }
        doLogin(teamName.trim(), password.trim());
    };
    return (_jsxs("div", { className: "h-screen w-screen bg-[#000000] flex items-center justify-center overflow-hidden select-none", children: [_jsx("div", { className: "absolute inset-0 comic-halftone opacity-30 pointer-events-none z-0" }), _jsxs("div", { className: "relative w-full h-full max-w-[1448px] max-h-[1086px] aspect-[1448/1086] bg-contain bg-center bg-no-repeat flex items-center justify-center z-10", style: { backgroundImage: `url(${loginBg})` }, children: [error && (_jsx("div", { className: "absolute left-1/2 -translate-x-1/2 top-[24%] z-30 bg-red-600 border-4 border-black text-white px-6 py-2 font-display text-xl tracking-wider shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transform -rotate-1 animate-bounce", children: error })), _jsxs("div", { className: "absolute left-1/2 top-[51%] -translate-x-1/2 -translate-y-1/2 w-[32%] min-w-[280px] flex flex-col gap-6 z-20", children: [_jsxs("div", { className: "flex flex-col gap-1 relative", children: [_jsx("label", { className: "absolute -top-3 left-4 font-display text-sm md:text-base text-black tracking-wide bg-yellow-400 border-2 border-black px-2 py-0.5 transform -rotate-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] z-10", children: "TEAM NAME" }), _jsx("input", { type: "text", value: teamName, onChange: (e) => setTeamName(e.target.value), className: "w-full bg-white border-4 border-black p-3 pt-4 text-black font-sans font-bold text-base md:text-lg focus:outline-none focus:bg-yellow-50 placeholder-black/30 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-colors", placeholder: "e.g. Spider Squad", onKeyDown: e => e.key === 'Enter' && handleSubmit(e) })] }), _jsxs("div", { className: "flex flex-col gap-1 relative mt-2", children: [_jsx("label", { className: "absolute -top-3 left-4 font-display text-sm md:text-base text-black tracking-wide bg-blue-400 border-2 border-black px-2 py-0.5 transform rotate-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] z-10", children: "PASSWORD" }), _jsx("input", { type: "password", value: password, onChange: (e) => setPassword(e.target.value), className: "w-full bg-white border-4 border-black p-3 pt-4 text-black font-sans font-bold text-base md:text-lg focus:outline-none focus:bg-blue-50 placeholder-black/30 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] transition-colors", placeholder: "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022", onKeyDown: e => e.key === 'Enter' && handleSubmit(e) })] }), _jsxs("div", { className: "mt-1", children: [_jsx("div", { className: "text-[10px] font-mono font-bold text-black/60 uppercase tracking-widest mb-1.5 text-center", children: "\u26A1 QUICK LOGIN (Dev Mode)" }), _jsx("div", { className: "grid grid-cols-2 gap-1.5 max-h-[160px] overflow-y-auto p-1 border-2 border-black bg-white/40 shadow-inner", children: testTeams.map(t => (_jsx("button", { type: "button", onClick: () => doLogin(t.name, t.password), disabled: loading, className: "bg-yellow-400 hover:bg-yellow-300 border-2 border-black text-black font-bold text-[11px] py-1.5 px-2 shadow-[2px_2px_0_#000] active:translate-y-0.5 active:translate-x-0.5 active:shadow-none transition-all truncate disabled:opacity-50 text-left", title: `Login as ${t.name}`, children: t.name }, t.id))) })] })] }), _jsx("button", { onClick: handleSubmit, type: "button", disabled: loading, className: "absolute left-[49.7%] top-[77.4%] -translate-x-1/2 -translate-y-1/2 w-[10.5%] aspect-square rounded-full cursor-pointer z-20 outline-none group bg-transparent", title: "TRANSMIT CREDENTIALS", children: _jsx("div", { className: `absolute inset-0 rounded-full bg-transparent group-hover:bg-red-600/10 group-hover:scale-105 group-active:scale-95 group-hover:shadow-[0_0_25px_rgba(239,68,68,0.7)] border-4 border-transparent group-hover:border-red-500/40 transition-all duration-200 ${loading ? 'animate-pulse' : ''}` }) })] })] }));
}
//# sourceMappingURL=LoginPage.js.map