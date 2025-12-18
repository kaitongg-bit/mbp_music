
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- Config ---
const TARGET_MODEL = 'gemini-2.5-flash';
const RECOMPOSE_INTERVAL = 18000;
const INITIAL_BPM = 105;

interface SectionDNA {
  drums: { kick: number[], snare: number[], hihat: number[], glitch: number[] };
  bassLine: number[];
  leadMelody: (number | null)[];
  chordProgression: number[][];
  arpPattern: number[];
  probMap: number[];
}

interface MasterDNA {
  sections: { A: SectionDNA, B: SectionDNA };
  genre: string;
  palette: string;
  energy: number;
  color: string;
  mood: string;
  scale: string;
  aiThought?: string;
}

const INITIAL_DNA: MasterDNA = {
  sections: {
    A: {
      drums: { kick: [1, 0, 0, 0, 1, 0, 0, 0], snare: [0, 0, 1, 0, 0, 0, 1, 0], hihat: [1, 1, 1, 1, 1, 1, 1, 1], glitch: [0, 0, 0, 0, 0, 0, 0, 1] },
      bassLine: [36, 36, 36, 36, 36, 36, 36, 36],
      leadMelody: [60, null, 63, 65, null, 67, null, 60],
      chordProgression: [[48, 52, 55, 58]],
      arpPattern: [1, 0, 1, 0, 1, 0, 1, 0],
      probMap: Array(8).fill(0.9)
    },
    B: {
      drums: { kick: [1, 1, 0, 0, 1, 1, 0, 0], snare: [0, 0, 1, 1, 0, 0, 1, 1], hihat: [1, 0, 1, 0, 1, 0, 1, 0], glitch: [1, 1, 1, 1, 0, 0, 0, 0] },
      bassLine: [34, 34, 34, 34, 34, 34, 34, 34],
      leadMelody: [58, 60, null, 58, 60, null, 62, 63],
      chordProgression: [[46, 50, 53, 57]],
      arpPattern: [1, 1, 1, 1, 0, 0, 0, 0],
      probMap: Array(8).fill(0.7)
    }
  },
  genre: "DREAM_ELECTRONICA",
  palette: 'ETHEREAL',
  energy: 0.5,
  color: "#a855f7",
  mood: "MYSTICAL",
  scale: "C Minor",
  aiThought: "System initialized. Optimizing for high-speed neural synthesis..."
};

function App() {
  const [isActive, setIsActive] = useState(false);
  const [bpm, setBpm] = useState(INITIAL_BPM);
  const [dna, setDna] = useState<MasterDNA>(INITIAL_DNA);
  const [status, setStatus] = useState('STANDBY');
  const [audioLevel, setAudioLevel] = useState(0);
  const [mutationTimer, setMutationTimer] = useState(RECOMPOSE_INTERVAL / 1000);
  const [currentStep, setCurrentStep] = useState(0);
  const [currentSection, setCurrentSection] = useState<'A' | 'B'>('A');
  const [showRaw, setShowRaw] = useState(false);

  // Widget specific states
  const [isMiniMode, setIsMiniMode] = useState(false);
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [tempBpm, setTempBpm] = useState(INITIAL_BPM.toString());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const isActiveRef = useRef(false);
  const bpmRef = useRef(INITIAL_BPM);
  const dnaRef = useRef(INITIAL_DNA);
  const stepRef = useRef(0);
  const nextStepTime = useRef(0);
  const schedulerTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const generationHistoryRef = useRef<{ bpm: number; samples: MasterDNA[] }>({ bpm: INITIAL_BPM, samples: [] });
  const historyIndexRef = useRef(0);

  const ai = useMemo(() => new GoogleGenAI({ apiKey: process.env.API_KEY }), []);

  const initAudio = async () => {
    if (!audioCtxRef.current) {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      const master = ctx.createGain();
      master.gain.setValueAtTime(0.4, ctx.currentTime);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;

      const delay = ctx.createDelay(1.0);
      delay.delayTime.setValueAtTime(0.375, ctx.currentTime);
      const delayFeedback = ctx.createGain();
      delayFeedback.gain.setValueAtTime(0.4, ctx.currentTime);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);

      const reverb = ctx.createConvolver();
      const length = ctx.sampleRate * 2.5;
      const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let i = 0; i < 2; i++) {
        const channel = impulse.getChannelData(i);
        for (let j = 0; j < length; j++) channel[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, 2.5);
      }
      reverb.buffer = impulse;

      master.connect(delay);
      delay.connect(reverb);
      reverb.connect(ctx.destination);
      master.connect(analyser);
      analyser.connect(ctx.destination);

      masterGainRef.current = master;
      analyserRef.current = analyser;
    }
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();
  };

  const playInstrument = (freq: number, time: number, dur: number, vol: number, type: OscillatorType = 'sine', env: 'pluck' | 'pad' | 'lead' = 'pluck') => {
    const ctx = audioCtxRef.current;
    if (!ctx || !masterGainRef.current) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(env === 'pad' ? 800 : 2200, time);
    g.gain.setValueAtTime(0, time);
    if (env === 'pluck') {
      g.gain.linearRampToValueAtTime(vol, time + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    } else if (env === 'pad') {
      g.gain.linearRampToValueAtTime(vol, time + dur * 0.4);
      g.gain.linearRampToValueAtTime(0.001, time + dur);
    } else {
      g.gain.linearRampToValueAtTime(vol, time + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    }
    osc.connect(filter);
    filter.connect(g);
    g.connect(masterGainRef.current);
    osc.start(time);
    osc.stop(time + dur);
  };

  const playPerc = (type: string, time: number, vol: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !masterGainRef.current) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    if (type === 'kick') {
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
    } else if (type === 'snare') {
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      for (let i = 0; i < buf.length; i++) buf.getChannelData(0)[i] = Math.random() * 2 - 1;
      noise.buffer = buf;
      g.gain.setValueAtTime(vol * 0.4, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      noise.connect(g);
      g.connect(masterGainRef.current);
      noise.start(time);
      return;
    } else {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(type === 'hat' ? 8000 : 1500, time);
      g.gain.setValueAtTime(vol * 0.08, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    }
    osc.connect(g);
    g.connect(masterGainRef.current);
    osc.start(time);
    osc.stop(time + 0.3);
  };

  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isActiveRef.current) return;
    const lookAhead = 0.2;
    while (nextStepTime.current < ctx.currentTime + lookAhead) {
      const time = nextStepTime.current;
      const step = stepRef.current % 16;
      const sectionKey = Math.floor(stepRef.current / 32) % 2 === 0 ? 'A' : 'B';
      const curSection = dnaRef.current.sections[sectionKey];
      const stepIdx = step % 8;
      const stepDur = 60 / bpmRef.current / 4;

      if (Math.random() < (curSection.probMap?.[stepIdx] ?? 0.9)) {
        if (curSection.drums.kick[stepIdx]) playPerc('kick', time, 1);
        if (curSection.drums.snare[stepIdx]) playPerc('snare', time, 0.7);
        if (curSection.drums.hihat[stepIdx]) playPerc('hat', time, 0.4);
        if (curSection.drums.glitch?.[stepIdx]) playPerc('glitch', time, 0.3);
        if (curSection.bassLine?.[stepIdx]) {
          const freq = 440 * Math.pow(2, (curSection.bassLine[stepIdx] - 69) / 12);
          playInstrument(freq, time, stepDur * 0.8, 0.4, 'triangle', 'pluck');
        }
        const leadNote = curSection.leadMelody?.[stepIdx];
        if (leadNote !== null && leadNote !== undefined) {
          const freq = 440 * Math.pow(2, (leadNote - 69) / 12);
          playInstrument(freq, time, stepDur * 1.5, 0.2, 'sawtooth', 'lead');
        }
        if (curSection.arpPattern?.[stepIdx]) {
          const chord = curSection.chordProgression[0] || [60, 64, 67];
          const note = chord[Math.floor(Math.random() * chord.length)] + 12;
          playInstrument(440 * Math.pow(2, (note - 69) / 12), time, 0.15, 0.1, 'sine', 'pluck');
        }
      }
      if (step % 8 === 0) {
        (curSection.chordProgression[0] || [60, 64, 67]).forEach(n => {
          playInstrument(440 * Math.pow(2, (n - 69) / 12), time, stepDur * 8.2, 0.08, 'sine', 'pad');
        });
      }
      setTimeout(() => { setCurrentStep(stepIdx); setCurrentSection(sectionKey); }, (time - ctx.currentTime) * 1000);
      nextStepTime.current += stepDur;
      stepRef.current++;
    }
    schedulerTimerRef.current = window.setTimeout(scheduler, 40);
  }, []);

  const fetchNewDNA = async () => {
    if (!isActiveRef.current) return;

    const currentBpm = bpmRef.current;

    // Reset history if BPM changed
    if (generationHistoryRef.current.bpm !== currentBpm) {
      generationHistoryRef.current = { bpm: currentBpm, samples: [] };
      historyIndexRef.current = -1;
    }

    // Reuse stored DNA if we have 3 samples
    if (generationHistoryRef.current.samples.length >= 3) {
      setMutationTimer(RECOMPOSE_INTERVAL / 1000);

      const nextIndex = (historyIndexRef.current + 1) % generationHistoryRef.current.samples.length;
      historyIndexRef.current = nextIndex;
      const cachedDna = generationHistoryRef.current.samples[nextIndex];

      setStatus(`RECALLING...`);
      // Small delay to simulate transition
      setTimeout(() => {
        setDna(cachedDna);
        dnaRef.current = cachedDna;
        setStatus(`${cachedDna.genre.toUpperCase()} (CACHED)`);
      }, 500);
      return;
    }

    setStatus('CALCULATING...');
    setMutationTimer(RECOMPOSE_INTERVAL / 1000);
    try {
      const response = await ai.models.generateContent({
        model: TARGET_MODEL,
        contents: `BPM: ${bpmRef.current}. Compose Music DNA. 
        RULES:
        1. LeadMelody: At least 5 MIDI notes (60-84).
        2. Chords: Lush 4-note structures.
        3. aiThought: MAX 15 WORDS summarize.
        FASTEST RESPONSE REQUIRED.`,
        config: {
          systemInstruction: "You are a fast MIDI orchestrator. Output strict JSON. aiThought must be ultra-short (under 15 words).",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              genre: { type: Type.STRING },
              aiThought: { type: Type.STRING, description: "EXTREMELY SHORT (MAX 15 WORDS) intention." },
              scale: { type: Type.STRING },
              mood: { type: Type.STRING },
              color: { type: Type.STRING },
              sections: {
                type: Type.OBJECT,
                properties: {
                  A: { type: Type.OBJECT, properties: { drums: { type: Type.OBJECT, properties: { kick: { type: Type.ARRAY, items: { type: Type.NUMBER } }, snare: { type: Type.ARRAY, items: { type: Type.NUMBER } }, hihat: { type: Type.ARRAY, items: { type: Type.NUMBER } }, glitch: { type: Type.ARRAY, items: { type: Type.NUMBER } } } }, bassLine: { type: Type.ARRAY, items: { type: Type.NUMBER } }, leadMelody: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } }, chordProgression: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } }, arpPattern: { type: Type.ARRAY, items: { type: Type.NUMBER } }, probMap: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
                  B: { type: Type.OBJECT, properties: { drums: { type: Type.OBJECT, properties: { kick: { type: Type.ARRAY, items: { type: Type.NUMBER } }, snare: { type: Type.ARRAY, items: { type: Type.NUMBER } }, hihat: { type: Type.ARRAY, items: { type: Type.NUMBER } }, glitch: { type: Type.ARRAY, items: { type: Type.NUMBER } } } }, bassLine: { type: Type.ARRAY, items: { type: Type.NUMBER } }, leadMelody: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } }, chordProgression: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } }, arpPattern: { type: Type.ARRAY, items: { type: Type.NUMBER } }, probMap: { type: Type.ARRAY, items: { type: Type.NUMBER } } } }
                }
              }
            }
          }
        }
      });
      const res = JSON.parse(response.text || "{}");
      const mergedDna = { ...INITIAL_DNA, ...res };
      console.log("AI Generation Success:", res);

      // Add to history
      generationHistoryRef.current.samples.push(mergedDna);
      historyIndexRef.current = generationHistoryRef.current.samples.length - 1;

      setDna(mergedDna);
      dnaRef.current = mergedDna;
      setStatus(`${mergedDna.genre.toUpperCase()}`);
    } catch (e) {
      console.error("AI Generation Failed:", e);
      setStatus('THINKING_FAILED');
    }
  };

  useEffect(() => {
    let int: number, tInt: number;
    if (isActive) {
      int = window.setInterval(fetchNewDNA, RECOMPOSE_INTERVAL);
      tInt = window.setInterval(() => setMutationTimer(t => Math.max(0, t - 1)), 1000);
    }
    return () => { clearInterval(int); clearInterval(tInt); };
  }, [isActive]);

  useEffect(() => {
    let frame: number;
    const update = () => {
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        setAudioLevel(data.reduce((a, b) => a + b, 0) / data.length / 100);
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, []);

  const toggle = async () => {
    await initAudio();
    if (isActive) {
      setIsActive(false); isActiveRef.current = false;
      if (schedulerTimerRef.current) clearTimeout(schedulerTimerRef.current);
    } else {
      setIsActive(true); isActiveRef.current = true;
      nextStepTime.current = audioCtxRef.current!.currentTime + 0.1;
      scheduler(); fetchNewDNA();
    }
  };

  // BPM Control Logic for Widget
  const handleLongPress = (direction: number) => {
    if (longPressTimerRef.current) return;
    longPressTimerRef.current = window.setInterval(() => {
      setBpm(prev => {
        const next = Math.max(40, Math.min(240, prev + direction));
        bpmRef.current = next;
        return next;
      });
    }, 60);
  };

  const stopLongPress = () => {
    if (longPressTimerRef.current) {
      clearInterval(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleManualBpm = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseInt(tempBpm);
    if (!isNaN(val)) {
      setBpm(val);
      bpmRef.current = val;
    }
    setIsEditingBpm(false);
  };

  // Render Mini Mode
  if (isMiniMode) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[#0000] overflow-hidden font-sans">
        <div
          className="fixed inset-0 transition-colors duration-[3000ms] ease-in-out"
          style={{
            backgroundColor: isActive ? `${dna.color}15` : '#050505',
            backdropFilter: 'blur(100px)'
          }}
        />

        <div className="relative group select-none">
          {/* BPM Side Controllers */}
          <div
            onMouseDown={() => handleLongPress(-1)} onMouseUp={stopLongPress} onMouseLeave={stopLongPress}
            className="absolute -left-32 top-0 bottom-0 w-28 cursor-pointer z-50 flex items-center justify-end pr-4 opacity-0 group-hover:opacity-40 transition-opacity"
          >
            <div className="text-4xl font-thin text-blue-400">−</div>
          </div>
          <div
            onMouseDown={() => handleLongPress(1)} onMouseUp={stopLongPress} onMouseLeave={stopLongPress}
            className="absolute -right-32 top-0 bottom-0 w-28 cursor-pointer z-50 flex items-center justify-start pl-4 opacity-0 group-hover:opacity-40 transition-opacity"
          >
            <div className="text-4xl font-thin text-red-400">+</div>
          </div>

          {/* Main Orb */}
          <div
            onClick={(e) => { if (e.detail === 1) toggle(); }}
            onDoubleClick={() => { setIsEditingBpm(true); setTempBpm(bpm.toString()); }}
            className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-700 cursor-pointer overflow-hidden
              ${isActive ? 'scale-110' : 'scale-100'} 
              bg-white/[0.03] border border-white/10 backdrop-blur-3xl`}
            style={{
              boxShadow: isActive ? `0 0 100px ${dna.color}33, inset 0 0 30px ${dna.color}11` : '0 20px 50px rgba(0,0,0,0.8)'
            }}
          >
            {/* Audio Pulse */}
            <div
              className="absolute inset-0 rounded-full opacity-40 transition-transform duration-75 pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${dna.color} 0%, transparent 75%)`,
                transform: `scale(${1 + audioLevel * 1.5})`
              }}
            />

            {/* Display */}
            <div className="relative z-10 flex flex-col items-center">
              {isEditingBpm ? (
                <form onSubmit={handleManualBpm} className="flex flex-col items-center">
                  <input
                    autoFocus
                    type="text"
                    value={tempBpm}
                    onChange={e => setTempBpm(e.target.value)}
                    onBlur={() => setIsEditingBpm(false)}
                    className="bg-transparent text-center text-4xl font-black w-24 outline-none border-b border-white/40"
                  />
                </form>
              ) : (
                <>
                  <span className="text-5xl font-black italic tracking-tighter drop-shadow-2xl">{bpm}</span>
                  <div className="text-[9px] font-black opacity-30 uppercase tracking-[0.4em] mt-1">{isActive ? 'Synthesizing' : 'Ready'}</div>
                </>
              )}
            </div>

            {/* Step Ring */}
            <div className="absolute inset-2 border border-white/5 rounded-full pointer-events-none">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className={`absolute w-1.5 h-1.5 rounded-full transition-all duration-300`}
                  style={{
                    top: '50%', left: '50%',
                    transform: `rotate(${i * 45}deg) translate(0, -85px) scale(${currentStep === i ? 2.5 : 1})`,
                    backgroundColor: currentStep === i ? dna.color : 'rgba(255,255,255,0.08)',
                    boxShadow: currentStep === i ? `0 0 10px ${dna.color}` : 'none'
                  }}
                />
              ))}
            </div>
          </div>

          {/* Expand Button */}
          <button
            onClick={() => setIsMiniMode(false)}
            className="absolute -top-12 left-1/2 -translate-x-1/2 text-[9px] font-bold opacity-20 hover:opacity-100 transition-opacity uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full border border-white/10"
          >
            Expand_UI
          </button>

          {/* Status Label */}
          <div className="absolute -bottom-16 left-0 right-0 text-center">
            <p className="text-[9px] font-black opacity-30 uppercase tracking-[0.5em] transition-opacity duration-700 group-hover:opacity-100 truncate max-w-[200px] mx-auto">
              {status}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Render Full Dashboard
  return (
    <div className="min-h-screen bg-[#020202] text-white font-mono flex flex-col overflow-hidden selection:bg-purple-500 selection:text-white">
      {/* Background Ambience */}
      <div
        className="fixed inset-0 opacity-20 transition-all duration-[3000ms]"
        style={{ background: `radial-gradient(circle at 50% 50%, ${dna.color}aa 0%, transparent 70%)`, filter: 'blur(100px)' }}
      />

      <main className="relative z-10 flex flex-col h-screen max-w-7xl mx-auto w-full p-6">

        {/* Header Section */}
        <header className="flex justify-between items-end border-b border-white/5 pb-6 mb-8">
          <div className="space-y-1">
            <h1 className="text-4xl font-black tracking-tighter italic text-transparent bg-clip-text bg-gradient-to-r from-white to-white/30 uppercase">Neural_Strudel</h1>
            <p className="text-[10px] font-bold opacity-30 tracking-[0.4em] uppercase">AI Orchestrator v5.2 // {status}</p>
          </div>
          <div className="text-right flex flex-col items-end gap-2">
            <button
              onClick={() => setIsMiniMode(true)}
              className="text-[9px] font-black bg-white/10 hover:bg-white/20 transition-colors px-3 py-1 rounded-full border border-white/10 uppercase tracking-widest"
            >
              Shrink_to_Orb
            </button>
            <div className="flex flex-col items-end">
              <span className="text-[9px] font-black opacity-20 uppercase">Scale: {dna.scale}</span>
              <div className="text-4xl font-black tabular-nums">{mutationTimer}s</div>
            </div>
          </div>
        </header>

        <div className="flex-1 grid grid-cols-12 gap-6 overflow-hidden">

          {/* Left Panel: Controls & Metrics */}
          <div className="col-span-12 lg:col-span-3 flex flex-col gap-6">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-md">
              <div className="flex justify-between items-end mb-4">
                <span className="text-[9px] font-black opacity-30 uppercase tracking-widest">Arm_Frequency</span>
                <span className="text-5xl font-black italic tabular-nums">{bpm}</span>
              </div>
              <input
                type="range" min="40" max="180" value={bpm}
                onChange={(e) => { setBpm(parseInt(e.target.value)); bpmRef.current = parseInt(e.target.value); }}
                className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-white"
              />
            </div>

            <button
              onClick={toggle}
              className={`py-8 rounded-3xl text-2xl font-black italic transition-all active:scale-[0.97] border-2 ${isActive ? 'bg-transparent border-red-500/30 text-red-500' : 'bg-white text-black shadow-xl'}`}
            >
              {isActive ? 'HALT_SYNTH' : 'INIT_AI'}
            </button>

            {/* AI Thought Log: Extremely Shortened */}
            <div className="flex-1 bg-white/5 border border-white/10 rounded-3xl p-6 overflow-hidden flex flex-col">
              <span className="text-[9px] font-black opacity-30 uppercase mb-4 tracking-tighter">AI_Core_Intention</span>
              <div className="flex-1 text-[11px] text-emerald-400 font-black leading-relaxed italic opacity-90 overflow-y-auto custom-scrollbar uppercase">
                {dna.aiThought || "STANDBY..."}
              </div>
            </div>
          </div>

          {/* Right Panel: Sequencer & Manifest */}
          <div className="col-span-12 lg:col-span-9 flex flex-col gap-6 overflow-hidden">

            {/* Sequencer: Stabilized Visuals */}
            <div className="h-2/3 bg-white/5 border border-white/10 rounded-[2.5rem] p-10 flex flex-col justify-between relative overflow-hidden">
              <div className="flex justify-between text-[9px] font-black opacity-20 tracking-widest uppercase mb-4">
                <span>Melodic_DNA_Matrix</span>
                <span>Section: {currentSection}</span>
              </div>

              <div className="flex-1 grid grid-cols-8 gap-4 items-center">
                {(dna.sections[currentSection].leadMelody || []).map((note, i) => (
                  <div key={i} className="relative flex flex-col items-center group">
                    <div
                      className={`w-full h-40 rounded-2xl transition-all duration-700 ease-in-out border border-white/5 ${note ? 'bg-white/10' : 'bg-white/[0.02]'}`}
                      style={{
                        backgroundColor: (note && currentStep === i) ? dna.color : '',
                        boxShadow: (note && currentStep === i) ? `0 0 40px ${dna.color}66` : 'none',
                        transform: currentStep === i ? 'scale(1.05)' : 'scale(1)',
                        opacity: currentStep === i ? 1 : 0.4
                      }}
                    />
                    <span className={`text-[8px] mt-2 transition-opacity duration-500 ${currentStep === i ? 'opacity-100' : 'opacity-20'}`}>
                      {note ? `M_${note}` : '---'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="absolute inset-0 pointer-events-none grid grid-cols-8 opacity-[0.03]">
                {[...Array(8)].map((_, i) => <div key={i} className={`border-r border-white h-full ${currentStep === i ? 'bg-white' : ''}`} />)}
              </div>
            </div>

            {/* Raw Data Manifest: Confirm AI Involvement */}
            <div className="h-1/3 flex gap-6">
              <div className="flex-1 bg-black/40 border border-white/10 rounded-3xl p-6 relative overflow-hidden group">
                <div className="flex justify-between items-center mb-4">
                  <span className="text-[9px] font-black opacity-30 uppercase tracking-widest">Neural_Manifest</span>
                  <button onClick={() => setShowRaw(!showRaw)} className="text-[8px] bg-white/10 px-2 py-1 rounded hover:bg-white/20 transition-colors uppercase font-bold">
                    {showRaw ? 'HIDE_RAW' : 'VIEW_RAW'}
                  </button>
                </div>

                <div className="h-full overflow-y-auto font-mono text-[9px] text-emerald-500/70 custom-scrollbar">
                  {showRaw ? (
                    <pre className="whitespace-pre-wrap">{JSON.stringify(dna, null, 2)}</pre>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between border-b border-white/5 py-1"><span className="opacity-40">GENRE</span> <span>{dna.genre}</span></div>
                      <div className="flex justify-between border-b border-white/5 py-1"><span className="opacity-40">CHORDS</span> <span>{JSON.stringify(dna.sections[currentSection].chordProgression[0])}</span></div>
                      <div className="flex justify-between border-b border-white/5 py-1"><span className="opacity-40">BASS_LINE</span> <span className="truncate ml-4">{dna.sections[currentSection].bassLine.join(", ")}</span></div>
                      <div className="text-[8px] text-white/10 mt-2 uppercase tracking-tighter italic">[ OPTIMIZED FOR 2.5 FLASH SPEED ]</div>
                    </div>
                  )}
                </div>
              </div>

              <div className="w-64 bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col justify-between">
                <span className="text-[9px] font-black opacity-30 uppercase">Osc_Level</span>
                <div className="flex-1 w-full bg-white/5 rounded-2xl overflow-hidden mt-2 relative">
                  <div className="absolute inset-x-0 bottom-0 bg-white transition-all duration-75" style={{ height: `${audioLevel * 100}%`, opacity: 0.1 + audioLevel }} />
                </div>
              </div>
            </div>

          </div>
        </div>

        <footer className="mt-6 flex justify-between items-center text-[9px] font-black opacity-10 tracking-[1em] uppercase border-t border-white/5 pt-6">
          <span>Speed_Optimized_v5.2</span>
          <span>Low_Latency_Mode_On</span>
        </footer>
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
