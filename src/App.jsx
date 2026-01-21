
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const CHARACTERS = [
  {
    id: 'sara',
    name: 'سارا',
    subtitle: 'کچێکی 24 ساڵان لە هەولێر',
    avatar: '👧',
    avatarClass: 'female-avatar',
  },
  {
    id: 'kawa',
    name: 'کاوە',
    subtitle: 'کوڕێکی 26 ساڵان لە هەولێر',
    avatar: '👦',
    avatarClass: 'male-avatar',
  },
]

function App() {
  const [screen, setScreen] = useState('select')
  const [currentCharacterId, setCurrentCharacterId] = useState(null)
  const [callerName, setCallerName] = useState('')
  const [callerAvatar, setCallerAvatar] = useState('')
  const [callStatus, setCallStatus] = useState('پەیوەندی هەیە...')
  const [messages, setMessages] = useState([
    {
      type: 'ai',
      text: 'سڵاو! چۆنیت؟ دەتوانیت بە دەنگ یان نووسین قسەم لەگەڵ بکەیت 😊',
    },
  ])
  const [textInput, setTextInput] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [callStartTime, setCallStartTime] = useState(null)
  const [callDurationText, setCallDurationText] = useState('00:00')
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState('چاوەڕێ بکە...')

  const conversationRef = useRef(null)
  const audioRef = useRef(null)
  const recognitionRef = useRef(null)

  const currentCharacterMeta = useMemo(
    () => CHARACTERS.find((c) => c.id === currentCharacterId) ?? null,
    [currentCharacterId],
  )

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) return

    const recognition = new SpeechRecognition()
    recognition.lang = 'ar'
    recognition.continuous = false
    recognition.interimResults = false

    recognition.onstart = () => {
      setIsRecording(true)
    }

    recognition.onend = () => {
      setIsRecording(false)
    }

    recognition.onerror = () => {
      setIsRecording(false)
    }

    recognition.onresult = (event) => {
      const transcript = event?.results?.[0]?.[0]?.transcript
      if (typeof transcript === 'string' && transcript.trim()) {
        void sendMessage(transcript.trim())
      }
    }

    recognitionRef.current = recognition
  }, [])

  useEffect(() => {
    if (!callStartTime) {
      setCallDurationText('00:00')
      return
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - callStartTime) / 1000)
      const minutes = String(Math.floor(elapsed / 60)).padStart(2, '0')
      const seconds = String(elapsed % 60).padStart(2, '0')
      setCallDurationText(`${minutes}:${seconds}`)
    }, 1000)

    return () => clearInterval(interval)
  }, [callStartTime])

  useEffect(() => {
    if (!conversationRef.current) return
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight
  }, [messages, loading])

  async function postJson(url, body) {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body ?? {}),
    })

    const text = await resp.text()
    let data = null
    try {
      data = text ? JSON.parse(text) : null
    } catch (_err) {
      data = null
    }

    return { resp, text, data }
  }

  async function startCall(characterId) {
    setCurrentCharacterId(characterId)
    setLoadingText('پەیوەندی دەگیرێت...')
    setLoading(true)

    try {
      const { resp, text, data } = await postJson('/api/select_character', { character: characterId })

      if (!resp.ok) {
        const msg = data?.error ? String(data.error) : text || `HTTP ${resp.status}`
        alert(`هەڵە: ${msg}`)
        return
      }

      if (!data?.success) {
        alert(`هەڵە: ${data?.error ?? text ?? 'هەڵەیەک ڕوویدا'}`)
        return
      }

      setCallerName(data.character?.name ?? currentCharacterMeta?.name ?? '')
      setCallerAvatar(characterId === 'sara' ? '👧' : '👦')
      setCallStatus('پەیوەندی چالاکە')
      setScreen('call')
      setCallStartTime(Date.now())

      setMessages([
        {
          type: 'ai',
          text: data.initial_message
            ? data.initial_message
            : 'سڵاو! چۆنیت؟ دەتوانیت بە دەنگ یان نووسین قسەم لەگەڵ بکەیت 😊',
        },
      ])

      if (data.initial_audio) {
        playAudio(data.initial_audio)
      }
    } catch (err) {
      console.error(err)
      alert(`هەڵە: ${err?.message ?? 'Network error / server not running'}`)
    } finally {
      setLoading(false)
    }
  }

  async function endCall() {
    try {
      await postJson('/api/reset_conversation', {})
    } catch (_err) {
    } finally {
      setCallStartTime(null)
      setCurrentCharacterId(null)
      setCallerName('')
      setCallerAvatar('')
      setCallStatus('پەیوەندی هەیە...')
      setTextInput('')
      setMessages([
        {
          type: 'ai',
          text: 'سڵاو! چۆنیت؟ دەتوانیت بە دەنگ یان نووسین قسەم لەگەڵ بکەیت 😊',
        },
      ])
      setScreen('select')
    }
  }

  function toggleMic() {
    const recognition = recognitionRef.current
    if (!recognition) {
      alert('وەسفی دەنگ پشتگیری ناکرێت لە وێبگەڕەکەت')
      return
    }

    try {
      if (isRecording) {
        recognition.stop()
      } else {
        recognition.start()
      }
    } catch (_err) {
    }
  }

  async function sendMessage(message) {
    const clean = String(message ?? '').trim()
    if (!clean) return

    setMessages((prev) => [...prev, { type: 'user', text: clean }])
    setCallStatus('وەڵام دەداتەوە...')
    setLoadingText('وەڵامەکە ئامادە دەکرێت...')
    setLoading(true)

    try {
      const { resp, text, data } = await postJson('/api/send_message', { message: clean })

      if (!resp.ok) {
        const msg = data?.error ? String(data.error) : text || `HTTP ${resp.status}`
        alert(`هەڵە: ${msg}`)
        setCallStatus('پەیوەندی چالاکە')
        return
      }

      if (!data?.success) {
        alert(`هەڵە: ${data?.error ?? text ?? 'هەڵەیەک ڕوویدا'}`)
        setCallStatus('پەیوەندی چالاکە')
        return
      }

      setMessages((prev) => [...prev, { type: 'ai', text: data.response }])

      if (data.audio) {
        playAudio(data.audio)
      } else {
        setCallStatus('پەیوەندی چالاکە')
      }

      if (data.end_call) {
        setTimeout(() => {
          void endCall()
        }, 3000)
      }
    } catch (err) {
      console.error(err)
      alert(`هەڵە: ${err?.message ?? 'Network error / server not running'}`)
      setCallStatus('پەیوەندی چالاکە')
    } finally {
      setLoading(false)
    }
  }

  function playAudio(base64Audio) {
    const audioEl = audioRef.current
    if (!audioEl) return

    try {
      setCallStatus('قسە دەکات...')
      const blob = base64ToBlob(base64Audio, 'audio/wav')
      const url = URL.createObjectURL(blob)

      audioEl.src = url
      void audioEl.play()

      audioEl.onended = () => {
        URL.revokeObjectURL(url)
        setCallStatus('پەیوەندی چالاکە')
      }

      audioEl.onerror = () => {
        URL.revokeObjectURL(url)
        setCallStatus('پەیوەندی چالاکە')
      }
    } catch (_err) {
      setCallStatus('پەیوەندی چالاکە')
    }
  }

  function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64)
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    return new Blob([byteArray], { type: mimeType })
  }

  return (
    <div className="phone-container">
      <div className="phone-header">
        <div className="status-bar">
          <span className="time">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <div className="status-icons">
            <span>📶</span>
            <span>🔋</span>
          </div>
        </div>
      </div>

      {screen === 'select' ? (
        <div className="selection-screen" id="selectionScreen">
          <div className="app-header">
            <h1>☎️ پەیوەندی تەلەفۆنی</h1>
            <p>کێ پەیوەندی پێوە بکەیت؟</p>
          </div>

          <div className="contacts-list">
            {CHARACTERS.map((c) => (
              <div key={c.id} className="contact-card" onClick={() => void startCall(c.id)}>
                <div className={`contact-avatar ${c.avatarClass}`}>{c.avatar}</div>
                <div className="contact-info">
                  <h3>{c.name}</h3>
                  <p className="contact-status">{c.subtitle}</p>
                  <span className="online-badge">🟢 ئامادەیە</span>
                </div>
                <button className="call-btn" type="button">
                  📞
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="call-screen" id="callScreen">
          <div className="call-header">
            <button className="back-btn" type="button" onClick={() => void endCall()}>
              ↩️
            </button>
            <div className="call-duration" id="callDuration">
              {callDurationText}
            </div>
          </div>

          <div className="caller-info">
            <div className="caller-avatar" id="callerAvatar">
              {callerAvatar}
            </div>
            <h2 className="caller-name" id="callerName">
              {callerName}
            </h2>
            <p className="call-status" id="callStatus">
              {callStatus}
            </p>
          </div>

          <div className="conversation" id="conversationArea" ref={conversationRef}>
            {messages.map((m, idx) => (
              <div key={`${idx}-${m.type}`} className={m.type === 'user' ? 'user-bubble' : 'ai-bubble'}>
                {m.text}
              </div>
            ))}
          </div>

          <div className="call-controls">
            <button
              className={`control-btn mic-btn ${isRecording ? 'active' : ''}`}
              id="micBtn"
              type="button"
              onClick={toggleMic}
              title="دەنگ تۆمار بکە"
            >
              🎤
            </button>

            <button
              className="control-btn end-call-btn"
              type="button"
              onClick={() => void endCall()}
              title="پەیوەندی کۆتایی بێنە"
            >
              📞
            </button>

            <button className="control-btn speaker-btn active" type="button" title="بڵندگۆ">
              🔊
            </button>
          </div>

          <div className="text-input-section">
            <input
              type="text"
              id="textInput"
              placeholder="یان لێرە بنووسە..."
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  const msg = textInput
                  setTextInput('')
                  void sendMessage(msg)
                }
              }}
            />
            <button
              className="send-text-btn"
              type="button"
              onClick={() => {
                const msg = textInput
                setTextInput('')
                void sendMessage(msg)
              }}
            >
              ✈️
            </button>
          </div>
        </div>
      )}

      <audio ref={audioRef} style={{ display: 'none' }} />

      {loading ? (
        <div className="loading-overlay" id="loadingOverlay">
          <div className="spinner" />
          <p id="loadingText">{loadingText}</p>
        </div>
      ) : null}
    </div>
  )
}

export default App
