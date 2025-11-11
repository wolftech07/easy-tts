// Frontend logic for Easy TTS - Multi-Service with Auto-Fallback
(() => {
  const voiceEl = document.getElementById('voice');
  const speedEl = document.getElementById('speed');
  const speedValueEl = document.getElementById('speedValue');
  const textEl = document.getElementById('text');
  const playBtn = document.getElementById('play');
  const stopBtn = document.getElementById('stop');
  const downloadBtn = document.getElementById('download');
  const statusEl = document.getElementById('status');

  let currentAudio = null;
  let currentMethod = null;

  const EDGE_VOICES = [
    { id: 'en-US-JennyMultilingualNeural', name: 'Jenny (US)', gender: 'Female' },
    { id: 'en-US-ChristopherNeural', name: 'Christopher (US)', gender: 'Male' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia (UK)', gender: 'Female' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (UK)', gender: 'Male' },
    { id: 'en-AU-NatashaNeural', name: 'Natasha (AU)', gender: 'Female' },
    { id: 'en-AU-WilliamNeural', name: 'William (AU)', gender: 'Male' }
  ];

  const BROWSER_SUPPORT = { webSpeechApi: 'speechSynthesis' in window };

  function setStatus(msg, isError) {
    statusEl.style.whiteSpace = 'pre-wrap';
    statusEl.style.textAlign = 'left';
    statusEl.style.fontFamily = 'monospace';
    statusEl.style.padding = '12px';
    statusEl.style.backgroundColor = isError ? '#ffe8e8' : '#e8f4f8';
    statusEl.style.border = isError ? '2px solid #ff6b6b' : '2px solid #5dade2';
    statusEl.style.borderRadius = '6px';
    statusEl.style.color = isError ? '#c92a2a' : '#0c5460';
    statusEl.textContent = msg;
  }

  function populateVoices() {
    voiceEl.innerHTML = '';
    EDGE_VOICES.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      voiceEl.appendChild(opt);
    });
  }

  function stopAudioPlayback() {
    if (currentAudio) {
      currentAudio.pause();
      try { currentAudio.src = ''; } catch (e) {}
      currentAudio = null;
    }
  }

  populateVoices();

  speedEl.addEventListener('input', () => {
    speedValueEl.textContent = Number(speedEl.value).toFixed(2);
  });

  stopBtn.addEventListener('click', () => {
    stopAudioPlayback();
    setStatus('⏹️ Stopped.');
  });

  function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case "'": return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  async function generateSpeechEdgeTts(text, voiceId, speed) {
    const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US"><voice name="${voiceId}"><prosody rate="${speed}">${escapeXml(text)}</prosody></voice></speak>`;
    const headers = {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'Edge-TTS-Client'
    };

    const strategies = [
      { url: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1', headers: { ...headers, 'Origin': 'https://speech.platform.bing.com' } },
      { url: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4', headers: { ...headers, 'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold' } }
    ];

    let lastError;
    for (const strategy of strategies) {
      try {
        const response = await fetch(strategy.url, { method: 'POST', headers: strategy.headers, body: ssml, mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (blob.size === 0) throw new Error('Empty response');
        currentMethod = 'Edge TTS';
        return blob;
      } catch (err) {
        lastError = err;
      }
    }
    throw new Error(`Edge TTS: ${lastError?.message}`);
  }

  async function generateSpeechVoiceRss(text, speed) {
    try {
      const url = `https://api.voicerss.org/?key=a8f4e9e0fc0b4e9f&hl=en-us&r=${Math.round((speed - 1) * 10)}&c=mp3&f=44khz_16bit_mono&src=${encodeURIComponent(text)}`;
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size === 0 || blob.type.includes('json')) throw new Error('Invalid response');
      currentMethod = 'VoiceRSS';
      return blob;
    } catch (err) {
      throw new Error(`VoiceRSS: ${err.message}`);
    }
  }

  async function generateSpeechGoogle(text, speed) {
    try {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
      const response = await fetch(url, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('Empty response');
      currentMethod = 'Google Translate';
      return blob;
    } catch (err) {
      throw new Error(`Google Translate: ${err.message}`);
    }
  }

  async function generateSpeech(text, voiceId, speed) {
    const methods = [
      () => generateSpeechEdgeTts(text, voiceId, speed),
      () => generateSpeechVoiceRss(text, speed),
      () => generateSpeechGoogle(text, speed)
    ];

    let errors = [];
    for (let i = 0; i < methods.length; i++) {
      try {
        setStatus(`🔄 Trying service ${i + 1}/3...`);
        return await methods[i]();
      } catch (err) {
        console.warn(err);
        errors.push(err.message);
      }
    }
    throw new Error(`All services failed: ${errors.join(' | ')}`);
  }

  playBtn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) {
      setStatus('❌ Please enter some text first.', true);
      return;
    }

    if (text.length > 500) {
      setStatus(`⚠️ Text is long (${text.length} chars). This may take a moment...`, false);
    }

    const voiceId = voiceEl.value;
    const speed = Number(speedEl.value) || 1;

    stopAudioPlayback();
    setStatus('🎤 Finding best TTS service for your browser...');

    try {
      const audioBlob = await generateSpeech(text, voiceId, speed);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      currentAudio = audio;
      setStatus(`▶️ Playing with ${currentMethod}...`);
      
      audio.onended = () => {
        setStatus(`✅ Done! Used: ${currentMethod}`);
        try { URL.revokeObjectURL(audioUrl); } catch (e) {}
        currentAudio = null;
      };
      
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        throw new Error('Audio playback failed');
      };
      
      await audio.play();
    } catch (err) {
      console.error('All services failed:', err);

      if (BROWSER_SUPPORT.webSpeechApi) {
        try {
          setStatus('🎙️ Using browser voice (Web Speech API)...');
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = speed;
          
          const voices = window.speechSynthesis.getVoices();
          if (voices && voices.length > 0) {
            const voice = voices.find(v => v.lang === 'en-US') || voices[0];
            utterance.voice = voice;
          }

          window.speechSynthesis.speak(utterance);
          currentMethod = 'Web Speech API';
          setStatus('✅ Playing with Web Speech API');
          
          utterance.onend = () => {
            setStatus('✅ Playback completed');
            currentAudio = null;
          };
        } catch (fallbackErr) {
          setStatus(`❌ Error: ${err.message}\n\nPlease check your connection and try again.`, true);
        }
      } else {
        setStatus(`❌ All TTS services unavailable:\n${err.message}`, true);
      }
    }
  });

  downloadBtn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) {
      setStatus('❌ Please enter some text to download.', true);
      return;
    }

    const voiceId = voiceEl.value;
    const speed = Number(speedEl.value) || 1;

    setStatus('📥 Generating audio for download...');

    try {
      const audioBlob = await generateSpeech(text, voiceId, speed);
      const downloadUrl = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'tts.mp3';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(downloadUrl); } catch (e) {} }, 5000);
      setStatus(`✅ Download started! (Used: ${currentMethod})`);
    } catch (err) {
      console.error('Download error:', err);
      setStatus(`❌ Download failed.\n${err.message}\n\nTry:\n• Shorter text (max 500 characters)\n• Check your internet connection\n• Use a modern browser (Chrome, Firefox, Safari, Edge)`, true);
    }
  });

  speedValueEl.textContent = Number(speedEl.value).toFixed(2);
})();
