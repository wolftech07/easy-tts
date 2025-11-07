// Frontend logic for Edge TTS
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

  // Available Edge TTS voices (English only)
  const EDGE_VOICES = [
    { id: 'en-US-JennyMultilingualNeural', name: 'Jenny (US)', gender: 'Female' },
    { id: 'en-US-ChristopherNeural', name: 'Christopher (US)', gender: 'Male' },
    { id: 'en-GB-SoniaNeural', name: 'Sonia (UK)', gender: 'Female' },
    { id: 'en-GB-RyanNeural', name: 'Ryan (UK)', gender: 'Male' },
    { id: 'en-AU-NatashaNeural', name: 'Natasha (AU)', gender: 'Female' },
    { id: 'en-AU-WilliamNeural', name: 'William (AU)', gender: 'Male' }
  ];

  function setStatus(msg, isError) {
    statusEl.style.whiteSpace = 'pre-wrap';
    statusEl.style.textAlign = 'left';
    statusEl.style.fontFamily = 'monospace';
    statusEl.style.padding = '10px';
    statusEl.style.backgroundColor = isError ? '#fff0f0' : '#f0f0f0';
    statusEl.style.border = isError ? '1px solid #ffb4b4' : '1px solid #ddd';
    statusEl.style.borderRadius = '4px';
    statusEl.style.color = isError ? '#d63031' : '#2d3436';
    statusEl.textContent = msg;
  }

  // Populate voices dropdown
  function populateVoices() {
    voiceEl.innerHTML = '';
    EDGE_VOICES.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name}`;
      voiceEl.appendChild(opt);
    });
  }

  function stopAudioPlayback() {
    if (currentAudio) {
      currentAudio.pause();
      try { currentAudio.src = ''; } catch {}
      currentAudio = null;
    }
  }

  // Initialize voices
  populateVoices();

  speedEl.addEventListener('input', () => {
    speedValueEl.textContent = Number(speedEl.value).toFixed(2);
  });

  stopBtn.addEventListener('click', () => {
    stopAudioPlayback();
    setStatus('Stopped.');
  });

  // Function to safely encode text for SSML
  function escapeXml(unsafe) {
    return unsafe.replace(/[<>&'"]/g, c => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
      }
    });
  }

  // Function to generate speech using Edge TTS
  async function generateSpeech(text, voiceId, speed) {
    // Create SSML with pitch and rate adjustments
    const ssml = `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">
        <voice name="${voiceId}">
          <prosody rate="${speed}">
            ${escapeXml(text)}
          </prosody>
        </voice>
      </speak>`;

    // Modern headers that work with Edge TTS
    const headers = {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'Edge-TTS-Client'
    };

    // Try multiple connection strategies
    const strategies = [
      {
        name: 'Direct Connection',
        url: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1',
        headers: {
          ...headers,
          'Origin': 'https://speech.platform.bing.com'
        }
      },
      {
        name: 'TTS Service',
        url: 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
        headers: {
          ...headers,
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold'
        }
      }
    ];

    let lastError;
    for (const strategy of strategies) {
      try {
        setStatus(`Trying ${strategy.name}...`);
        const response = await fetch(strategy.url, {
          method: 'POST',
          headers: strategy.headers,
          body: ssml
        });

        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${await response.text()}`);
        }

        const blob = await response.blob();
        if (blob.size === 0) {
          throw new Error('Received empty audio data');
        }

        setStatus(`Success with ${strategy.name}! Processing audio...`);
        return blob;
      } catch (err) {
        console.warn(`${strategy.name} failed:`, err);
        lastError = err;
        setStatus(`${strategy.name} failed: ${err.message}`, true);
      }
    }

    throw new Error(`All connection strategies failed. Last error: ${lastError?.message}`);
  }

  // Function to generate speech using Web Speech API as fallback
  async function generateSpeechFallback(text, voiceId, speed) {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        reject(new Error('Web Speech API is not supported in this browser'));
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speed;
      
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) {
        reject(new Error('No speech voices available in this browser'));
        return;
      }

      let voice = voices.find(v => v.name.includes(voiceId)) || 
                 voices.find(v => v.lang === 'en-US' && v.default) ||
                 voices[0];

      if (voice) {
        utterance.voice = voice;
        setStatus([
          'Using fallback voice:',
          `- Name: ${voice.name}`,
          `- Language: ${voice.lang}`,
          `- Quality: ${voice.localService ? 'Local' : 'Network'}`,
          '(Edge TTS was not available)'
        ].join('\n'));
      }

      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`Speech synthesis failed: ${e.error}`));
      window.speechSynthesis.speak(utterance);
    });
  }

  // Play button handler
  playBtn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) {
      setStatus('Please enter some text first.', true);
      return;
    }

    const voiceId = voiceEl.value;
    const speed = Number(speedEl.value) || 1;

    stopAudioPlayback();
    setStatus('Generating speech...');

    try {
      // Try Edge TTS first
      const audioBlob = await generateSpeech(text, voiceId, speed);
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      currentAudio = audio;
      setStatus('Playing high-quality Edge TTS audio...');
      
      audio.onended = () => {
        setStatus('Playback completed successfully.');
        try { URL.revokeObjectURL(audioUrl); } catch {}
        currentAudio = null;
      };
      
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        throw new Error('Audio playback failed');
      };
      
      await audio.play();

    } catch (err) {
      console.error('Edge TTS failed:', err);
      setStatus('Edge TTS failed, trying browser fallback...', true);

      try {
        await generateSpeechFallback(text, voiceId, speed);
        setStatus('Playback completed using fallback voice.');
      } catch (fallbackErr) {
        const errorMessage = [
          'All speech methods failed.',
          '',
          'Edge TTS error:',
          err.message,
          '',
          'Fallback error:',
          fallbackErr.message,
          '',
          'Browser Information:',
          `- Type: ${navigator.userAgent.includes('Chrome') ? 'Chrome' : 'Other'}`,
          `- Web Speech API: ${('speechSynthesis' in window) ? 'Available' : 'Not Available'}`,
          '',
          'Troubleshooting:',
          '1. Check your internet connection',
          '2. Try shorter text (max 200 characters recommended)',
          '3. If using Codespaces, try incognito mode or local environment',
          '4. Disable VPN or proxy if active'
        ].join('\n');

        setStatus(errorMessage, true);
      }
    }
  });

  // Download button handler
  downloadBtn.addEventListener('click', async () => {
    const text = textEl.value.trim();
    if (!text) {
      setStatus('Please enter some text to download.', true);
      return;
    }

    const voiceId = voiceEl.value;
    const speed = Number(speedEl.value) || 1;

    setStatus('Generating audio for download...');

    try {
      const audioBlob = await generateSpeech(text, voiceId, speed);
      const downloadUrl = URL.createObjectURL(audioBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = 'tts.mp3';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => { try { URL.revokeObjectURL(downloadUrl); } catch {} }, 5000);
      setStatus('Download started.');
    } catch (err) {
      console.error('Download error:', err);
      setStatus([
        'Download failed.',
        err.message,
        '',
        'Troubleshooting:',
        '1. Try shorter text',
        '2. Check your internet connection',
        '3. Try downloading in a local environment',
        '4. Use a different browser (Edge recommended)'
      ].join('\n'), true);
    }
  });

  // Initialize speed display
  speedValueEl.textContent = Number(speedEl.value).toFixed(2);
})();