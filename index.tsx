
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
  color: string;
  mood: string;
  scale: string;
  aiThought?: string; 
}

const INITIAL_DNA: MasterDNA = {
  sections: {
    A: {
      drums: { kick: [1,0,0,0,1,0,0,0], snare: [0,0,1,0,0,0,1,0], hihat: [1,1,1,1,1,1,1,1], glitch: [0,0,0,0,0,0,0,1] },
      bassLine: [36, 36, 36, 36, 36, 36, 36, 36],
      leadMelody: [60, null, 63, 65, null, 67, null, 60],
      chordProgression: [[48, 52, 55, 58]],
      arpPattern: [1,0,1,0,1,0,1,0],
      probMap: Array(8).fill(0.9)
    },
    B: {
      drums: { kick: [1,1,0,0,1,1,0,0], snare: [0,0,1,1,0,0,1,1], hihat: [1,0,1,0,1,0,1,0], glitch: [1,1,1,1,0,0,0,0] },
      bassLine: [34, 34, 34, 34, 34, 34, 34, 34],
      leadMelody: [58, 60, null, 58, 60, null, 62, 63],
      chordProgression: [[46, 50, 53, 57]],
      arpPattern: [1,1,1,1,0,0,0,0],
      probMap: Array(8).fill(0.7)
    }
  },
  genre: "COMPLEX_ELECTRONICA",
  color: "#a855f7",
  mood: "ENERGIZED",
  scale: "C Minor",
  aiThought: "Core engine ready."
};

function App() {
  const [isActive, setIsActive] = useState(false);
  const [bpm, setBpm] = useState(INITIAL_BPM);
  const [dna, setDna] = useState<MasterDNA>(INITIAL_DNA);
  const [status, setStatus] = useState('IDLE');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isEditingBpm, setIsEditingBpm] = useState(false);
  const [tempBpm, setTempBpm] = useState(INITIAL_BPM.toString());
  const [currentStep, setCurrentStep] = useState(0);

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
      delayFeedback.gain.setValueAtTime(0.3, ctx.currentTime);
      delay.connect(delayFeedback); delayFeedback.connect(delay);
      
      master.connect(delay);
      delay.connect(ctx.destination);
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
    filter.frequency.setValueAtTime(env === 'pad' ? 800 : 2500, time);
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
    osc.connect(filter); filter.connect(g); g.connect(masterGainRef.current);
    osc.start(time); osc.stop(time + dur);
  };

  const playPerc = (type: string, time: number, vol: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !masterGainRef.current) return;
    const g = ctx.createGain();
    if (type === 'kick') {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(120, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.1);
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
      osc.connect(g); g.connect(masterGainRef.current);
      osc.start(time); osc.stop(time + 0.3);
    } else if (type === 'snare') {
      const noise = ctx.createBufferSource();
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
      for(let i=0; i<buf.length; i++) buf.getChannelData(0)[i] = Math.random()*2-1;
      noise.buffer = buf;
      g.gain.setValueAtTime(vol * 0.5, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
      noise.connect(g); g.connect(masterGainRef.current);
      noise.start(time);
    } else {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(type === 'hat' ? 9000 : 1800, time);
      g.gain.setValueAtTime(vol * 0.1, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      osc.connect(g); g.connect(masterGainRef.current);
      osc.start(time); osc.stop(time + 0.1);
    }
  };

  const scheduler = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isActiveRef.current) return;
    while (nextStepTime.current < ctx.currentTime + 0.2) {
      const time = nextStepTime.current;
      const stepIdx = stepRef.current % 8;
      const sectionKey = Math.floor(stepRef.current / 32) % 2 === 0 ? 'A' : 'B';
      const curSection = dnaRef.current.sections[sectionKey];
      const stepDur = 60 / bpmRef.current / 4;

      if (Math.random() < (curSection.probMap?.[stepIdx] ?? 0.8)) {
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
          playInstrument(freq, time, stepDur * 1.5, 0.25, 'sawtooth', 'lead');
        }

        if (curSection.arpPattern?.[stepIdx]) {
          const chord = curSection.chordProgression[0] || [60,64,67];
          const note = chord[Math.floor(Math.random() * chord.length)] + 12;
          playInstrument(440 * Math.pow(2, (note-69)/12), time, 0.15, 0.1, 'sine', 'pluck');
        }
      }

      if (stepIdx === 0) {
        (curSection.chordProgression[0] || [60,64,67]).forEach(n => {
          playInstrument(440 * Math.pow(2, (n-69)/12), time, stepDur * 8.2, 0.08, 'sine', 'pad');
        });
      }

      setTimeout(() => { setCurrentStep(stepIdx); }, (time - ctx.currentTime) * 1000);
      nextStepTime.current += stepDur;
      stepRef.current++;
    }
    schedulerTimerRef.current = window.setTimeout(scheduler, 40);
  }, []);

  const fetchNewDNA = async () => {
    if (!isActiveRef.current) return;
    setStatus('NEURAL_GEN...');
    try {
      const response = await ai.models.generateContent({
        model: TARGET_MODEL,
        contents: `BPM: ${bpmRef.current}. TASK: Virtuoso Electronic DNA. 
        MANDATORY: 
        1. COMPLEX leadMelody (MIDI 60-84, min 5 notes). 
        2. Lush 4-note chordProgression. 
        3. Glitch & Arp patterns.
        4. aiThought: ULTRA-CONCISE (max 10 words).`,
        config: {
          systemInstruction: "You are a master AI musician. Output complex MIDI patterns in strict JSON. Speed is priority.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              genre: { type: Type.STRING },
              aiThought: { type: Type.STRING, description: "Max 10 words summary." },
              scale: { type: Type.STRING },
              color: { type: Type.STRING },
              sections: {
                type: Type.OBJECT,
                properties: {
                  A: { type: Type.OBJECT, properties: { drums: { type: Type.OBJECT, properties: { kick: {type:Type.ARRAY, items:{type:Type.NUMBER}}, snare: {type:Type.ARRAY, items:{type:Type.NUMBER}}, hihat: {type:Type.ARRAY, items:{type:Type.NUMBER}}, glitch: {type:Type.ARRAY, items:{type:Type.NUMBER}} } }, bassLine: { type: Type.ARRAY, items: { type: Type.NUMBER } }, leadMelody: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } }, chordProgression: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } }, arpPattern: { type: Type.ARRAY, items: { type: Type.NUMBER } }, probMap: { type: Type.ARRAY, items: { type: Type.NUMBER } } } },
                  B: { type: Type.OBJECT, properties: { drums: { type: Type.OBJECT, properties: { kick: {type:Type.ARRAY, items:{type:Type.NUMBER}}, snare: {type:Type.ARRAY, items:{type:Type.NUMBER}}, hihat: {type:Type.ARRAY, items:{type:Type.NUMBER}}, glitch: {type:Type.ARRAY, items:{type:Type.NUMBER}} } }, bassLine: { type: Type.ARRAY, items: { type: Type.NUMBER } }, leadMelody: { type: Type.ARRAY, items: { type: Type.NUMBER, nullable: true } }, chordProgression: { type: Type.ARRAY, items: { type: Type.ARRAY, items: { type: Type.NUMBER } } }, arpPattern: { type: Type.ARRAY, items: { type: Type.NUMBER } }, probMap: { type: Type.ARRAY, items: { type: Type.NUMBER } } } }
                }
              }
            }
          }
        }
      });
      const res = JSON.parse(response.text || "{}");
      const mergedDna = { ...INITIAL_DNA, ...res };
      setDna(mergedDna);
      dnaRef.current = mergedDna;
      setStatus(mergedDna.aiThought?.toUpperCase() || 'STEADY');
    } catch (e) { setStatus('RETRYING...'); }
  };

  useEffect(() => {
    let frame: number;
    const update = () => {
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const level = data.reduce((a, b) => a + b, 0) / data.length / 100;
        setAudioLevel(level);
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (isActive) {
      const int = setInterval(fetchNewDNA, RECOMPOSE_INTERVAL);
      return () => clearInterval(int);
    }
  }, [isActive]);

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

  const handleLongPress = (direction: number) => {
    if (longPressTimerRef.current) return;
    longPressTimerRef.current = window.setInterval(() => {
      setBpm(prev => {
        const next = Math.max(40, Math.min(220, prev + direction));
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

  return (
    <div className="min-h-screen bg-[#000] flex items-center justify-center font-sans overflow-hidden">
      {/* Dynamic Aura Background */}
      <div 
        className="fixed inset-0 transition-colors duration-[3000ms] ease-in-out" 
        style={{ 
          backgroundColor: isActive ? `${dna.color}15` : '#050505',
          backdropFilter: 'blur(120px)' 
        }} 
      />

      {/* Widget Orb Container */}
      <div className="relative group select-none">
        
        {/* BPM Side Controllers */}
        <div 
          onMouseDown={() => handleLongPress(-1)} onMouseUp={stopLongPress} onMouseLeave={stopLongPress}
          className="absolute -left-36 top-0 bottom-0 w-32 cursor-pointer z-50 flex items-center justify-end pr-8 opacity-0 group-hover:opacity-40 transition-opacity"
        >
          <div className="text-5xl font-thin text-blue-400">−</div>
        </div>
        <div 
          onMouseDown={() => handleLongPress(1)} onMouseUp={stopLongPress} onMouseLeave={stopLongPress}
          className="absolute -right-36 top-0 bottom-0 w-32 cursor-pointer z-50 flex items-center justify-start pl-8 opacity-0 group-hover:opacity-40 transition-opacity"
        >
          <div className="text-5xl font-thin text-red-400">+</div>
        </div>

        {/* The Main Focus Orb */}
        <div 
          onClick={(e) => { if(e.detail === 1) toggle(); }}
          onDoubleClick={() => { setIsEditingBpm(true); setTempBpm(bpm.toString()); }}
          className={`relative w-52 h-52 rounded-full flex items-center justify-center transition-all duration-700 cursor-pointer overflow-hidden
            ${isActive ? 'scale-110' : 'scale-100'} 
            bg-white/[0.03] border border-white/10 backdrop-blur-3xl`}
          style={{ 
            boxShadow: isActive ? `0 0 100px ${dna.color}33, inset 0 0 30px ${dna.color}11` : '0 20px 50px rgba(0,0,0,0.8)'
          }}
        >
          {/* Audio Energy Pulse */}
          <div 
            className="absolute inset-0 rounded-full opacity-40 transition-transform duration-75 pointer-events-none"
            style={{ 
              background: `radial-gradient(circle, ${dna.color} 0%, transparent 75%)`,
              transform: `scale(${1 + audioLevel * 1.8})` 
            }}
          />

          {/* Central Display */}
          <div className="relative z-10 flex flex-col items-center">
            {isEditingBpm ? (
              <form onSubmit={handleManualBpm} className="flex flex-col items-center">
                <input 
                  autoFocus
                  type="text" 
                  value={tempBpm} 
                  onChange={e => setTempBpm(e.target.value)}
                  onBlur={() => setIsEditingBpm(false)}
                  className="bg-transparent text-center text-5xl font-black w-28 outline-none border-b-2 border-white/40 caret-white"
                />
              </form>
            ) : (
              <>
                <span className="text-6xl font-black italic tracking-tighter tabular-nums drop-shadow-2xl">{bpm}</span>
                <div className={`text-[10px] font-black opacity-30 uppercase tracking-[0.4em] mt-2 transition-all ${isActive ? 'text-white' : 'text-white/40'}`}>
                  {isActive ? 'Synthesizing' : 'Ready'}
                </div>
              </>
            )}
          </div>

          {/* Step Sequencer Ring Indicators */}
          <div className="absolute inset-3 border border-white/5 rounded-full pointer-events-none">
            {[...Array(8)].map((_, i) => (
              <div 
                key={i} 
                className={`absolute w-1.5 h-1.5 rounded-full transition-all duration-300`}
                style={{
                  top: '50%', left: '50%',
                  transform: `rotate(${i * 45}deg) translate(0, -90px) scale(${currentStep === i ? 2.5 : 1})`,
                  backgroundColor: currentStep === i ? dna.color : 'rgba(255,255,255,0.08)',
                  boxShadow: currentStep === i ? `0 0 15px ${dna.color}` : 'none',
                  opacity: currentStep === i ? 1 : 0.4
                }}
              />
            ))}
          </div>
        </div>

        {/* Bottom Status Ticker */}
        <div className="absolute -bottom-20 left-0 right-0 text-center px-4">
          <p className="text-[10px] font-black opacity-30 uppercase tracking-[0.6em] transition-opacity duration-700 group-hover:opacity-100 truncate max-w-[240px] mx-auto">
            {status}
          </p>
        </div>
      </div>

      {/* Micro-Stats Display (Floating) */}
      <div className="fixed bottom-12 left-12 right-12 flex justify-between items-end pointer-events-none text-white/10 uppercase font-black tracking-widest text-[9px]">
        <div className="flex gap-8">
           <div className="flex flex-col">
              <span>Model_Link</span>
              <span className="text-white/20">Gemini_2.5_Flash</span>
           </div>
           <div className="flex flex-col">
              <span>Orch_Mode</span>
              <span className="text-white/20">Virtuoso_Full_Track</span>
           </div>
        </div>
        <div className="text-right flex flex-col">
           <span>Harmonic_Scale</span>
           <span className="text-white/20">{dna.scale}</span>
        </div>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
