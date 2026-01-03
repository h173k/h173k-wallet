/**
 * H173K Wallet - QR Code Components
 * Scanner and Generator for addresses
 * 
 * FIXES:
 * - Standard black-on-white QR for universal compatibility
 * - iOS video attributes for mobile camera
 * - Better error handling for video.play()
 * - inversionAttempts: 'attemptBoth' for scanning inverted QRs
 */

import React, { useState, useEffect, useRef, useCallback } from 'react'

// ========== QR CODE GENERATOR ==========

export function QRCodeGenerator({ 
  data, 
  size = 200, 
  logo = null,
  errorCorrectionLevel = 'M',
  className = ''
}) {
  const canvasRef = useRef(null)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)
  
  useEffect(() => {
    if (!data) {
      setError('No data provided')
      return
    }
    
    if (!canvasRef.current) {
      return
    }
    
    const generateQR = async () => {
      setError(null)
      setReady(false)
      
      try {
        const QRCodeLib = await import('qrcode')
        const QRCode = QRCodeLib.default || QRCodeLib
        
        // Use STANDARD black-on-white colors for universal compatibility
        // This ensures QR codes work across all scanners including our own
        await QRCode.toCanvas(canvasRef.current, data, {
          width: size,
          margin: 2,
          color: {
            dark: '#000000',   // Black QR modules (standard)
            light: '#ffffff'   // White background (standard)
          },
          errorCorrectionLevel
        })
        
        // Add logo if provided
        if (logo && canvasRef.current) {
          const ctx = canvasRef.current.getContext('2d')
          const img = new Image()
          img.onload = () => {
            const logoSize = size * 0.25
            const logoX = (size - logoSize) / 2
            const logoY = (size - logoSize) / 2
            
            // White background behind logo
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(logoX - 4, logoY - 4, logoSize + 8, logoSize + 8)
            ctx.drawImage(img, logoX, logoY, logoSize, logoSize)
          }
          img.src = logo
        }
        
        setReady(true)
      } catch (err) {
        console.error('QR generation error:', err)
        setError('Failed to generate QR code: ' + err.message)
      }
    }
    
    generateQR()
  }, [data, size, logo, errorCorrectionLevel])
  
  if (error) {
    return <div className="qr-error">{error}</div>
  }
  
  return (
    <div className={`qr-code-container ${className}`}>
      <canvas ref={canvasRef} />
    </div>
  )
}

// ========== QR CODE SCANNER ==========

export function QRCodeScanner({ 
  onScan, 
  onError,
  facingMode = 'environment',
  className = '' 
}) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const animationRef = useRef(null)
  const streamRef = useRef(null)
  const jsQRRef = useRef(null)
  const mountedRef = useRef(true)
  
  const [scanning, setScanning] = useState(false)
  const [hasCamera, setHasCamera] = useState(true)
  const [error, setError] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  
  // Load jsQR on mount
  useEffect(() => {
    mountedRef.current = true
    
    import('jsqr').then(module => {
      if (mountedRef.current) {
        jsQRRef.current = module.default
        console.log('✅ jsQR loaded')
      }
    }).catch(err => {
      console.error('Failed to load jsQR:', err)
      if (mountedRef.current) {
        setError('Failed to load scanner')
      }
    })
    
    return () => {
      mountedRef.current = false
    }
  }, [])
  
  // Set iOS-specific video attributes (React doesn't handle webkit- attrs well)
  useEffect(() => {
    if (videoRef.current) {
      const video = videoRef.current
      video.setAttribute('playsinline', '')
      video.setAttribute('webkit-playsinline', '')
      video.setAttribute('x-webkit-airplay', 'allow')
    }
  }, [])
  
  // Stop camera
  const stopCamera = useCallback(() => {
    console.log('🛑 Stopping camera...')
    
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop()
        console.log('Track stopped:', track.kind)
      })
      streamRef.current = null
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    
    setScanning(false)
    setCameraReady(false)
  }, [])
  
  // Start camera
  const startCamera = useCallback(async () => {
    console.log('📷 Starting camera...')
    setError(null)
    setHasCamera(true)
    
    // Stop any existing stream first
    stopCamera()
    
    try {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not available. Make sure you are using HTTPS.')
      }
      
      // Try back camera first (for mobile), then any camera as fallback
      let stream = null
      
      // Attempt 1: Back camera with flexible constraints (best for mobile QR scanning)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { 
            facingMode: { exact: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        })
        console.log('✅ Got back camera')
      } catch (backCamErr) {
        console.log('Back camera failed, trying any camera...', backCamErr.name)
        
        // Attempt 2: Any camera with minimal constraints
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { 
              facingMode: facingMode,
              width: { ideal: 640 },
              height: { ideal: 480 }
            },
            audio: false
          })
          console.log('✅ Got fallback camera')
        } catch (anyCamErr) {
          console.log('Fallback failed, trying minimal...', anyCamErr.name)
          
          // Attempt 3: Absolute minimal - just give me ANY video
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          })
          console.log('✅ Got minimal camera')
        }
      }
      
      if (!mountedRef.current) {
        // Component unmounted while waiting for camera
        stream.getTracks().forEach(track => track.stop())
        return
      }
      
      console.log('✅ Got camera stream:', stream.getVideoTracks()[0]?.label)
      streamRef.current = stream
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        
        // Wait for video to be ready
        videoRef.current.onloadedmetadata = async () => {
          console.log('Video metadata loaded')
          if (!mountedRef.current) return
          
          try {
            // Play video - this may fail on iOS without user interaction
            await videoRef.current.play()
            console.log('✅ Video playing')
            
            if (mountedRef.current) {
              setCameraReady(true)
              setScanning(true)
              setError(null)
            }
          } catch (playErr) {
            console.error('Video play error:', playErr)
            // On iOS, autoplay might be blocked - try again on user interaction
            if (playErr.name === 'NotAllowedError') {
              setError('Tap to start camera')
              // Set up click handler to retry
              if (videoRef.current) {
                videoRef.current.onclick = async () => {
                  try {
                    await videoRef.current.play()
                    setCameraReady(true)
                    setScanning(true)
                    setError(null)
                    videoRef.current.onclick = null
                  } catch (e) {
                    console.error('Retry play failed:', e)
                  }
                }
              }
            }
          }
        }
        
        videoRef.current.onerror = (e) => {
          console.error('Video error:', e)
          setError('Video error occurred')
        }
      }
    } catch (err) {
      console.error('Camera error:', err)
      
      if (!mountedRef.current) return
      
      setHasCamera(false)
      
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera access denied. Please allow camera access in your browser settings.')
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera found on this device.')
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera is in use by another application.')
      } else if (err.name === 'OverconstrainedError') {
        setError('Camera does not meet requirements.')
      } else if (err.message?.includes('HTTPS')) {
        setError('Camera requires HTTPS connection.')
      } else {
        setError('Unable to access camera: ' + (err.message || err.name || 'Unknown error'))
      }
      
      onError?.(err)
    }
  }, [facingMode, onError, stopCamera])
  
  // Auto-start camera on mount
  useEffect(() => {
    // Start immediately - delay can break user gesture context on iOS
    startCamera()
    
    return () => {
      stopCamera()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  
  // Scan for QR codes
  useEffect(() => {
    if (!scanning || !cameraReady || !videoRef.current || !canvasRef.current) {
      return
    }
    
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    
    let scanCount = 0
    
    const scan = () => {
      if (!mountedRef.current || !jsQRRef.current) {
        animationRef.current = requestAnimationFrame(scan)
        return
      }
      
      if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationRef.current = requestAnimationFrame(scan)
        return
      }
      
      // Set canvas size to match video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        
        // Try both normal and inverted QR codes
        const code = jsQRRef.current(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth'
        })
        
        if (code && code.data) {
          console.log('🎯 QR Code detected:', code.data)
          
          // Validate it's a Solana address or payment URL
          const data = code.data.trim()
          const parsed = parseQRData(data)
          
          if (parsed.address && isValidSolanaAddress(parsed.address)) {
            console.log('✅ Valid Solana address found:', parsed.address)
            stopCamera()
            onScan(parsed)
            return
          } else if (isValidSolanaAddress(data)) {
            console.log('✅ Valid plain Solana address:', data)
            stopCamera()
            onScan({ type: 'address', address: data })
            return
          } else {
            // Log but continue scanning - might be a different QR
            scanCount++
            if (scanCount % 60 === 0) { // Log every ~1 second at 60fps
              console.log('QR found but not valid Solana address:', data.substring(0, 50))
            }
          }
        }
      } catch (scanErr) {
        // Ignore scanning errors, just continue
        console.error('Scan error:', scanErr)
      }
      
      animationRef.current = requestAnimationFrame(scan)
    }
    
    console.log('🔍 Starting QR scan loop')
    animationRef.current = requestAnimationFrame(scan)
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [scanning, cameraReady, onScan, stopCamera])
  
  // Error/no camera state
  if (!hasCamera || (error && !error.includes('Tap to start'))) {
    return (
      <div className={`qr-scanner-error ${className}`}>
        <div className="scanner-error-icon">📷</div>
        <p>{error || 'Camera not available'}</p>
        <p className="scanner-error-hint">
          Please enable camera access in your device settings
        </p>
        <button className="btn btn-primary" onClick={startCamera} style={{ marginTop: '16px' }}>
          Try Again
        </button>
      </div>
    )
  }
  
  return (
    <div className={`qr-scanner-container ${className}`}>
      <div className="scanner-viewport">
        <video 
          ref={videoRef} 
          autoPlay
          playsInline
          muted
          disablePictureInPicture
          disableRemotePlayback
          className="scanner-video"
          style={{ 
            width: '100%', 
            height: '100%', 
            objectFit: 'cover',
            transform: 'scaleX(1)' // Prevent mirror on some devices
          }}
        />
        <canvas 
          ref={canvasRef} 
          className="scanner-canvas" 
          style={{ display: 'none' }}
        />
        <div className="scanner-overlay">
          <div className="scanner-frame" />
        </div>
        {(!cameraReady || error) && (
          <div className="scanner-loading" onClick={error ? startCamera : undefined}>
            {error ? (
              <>
                <p>{error}</p>
                <p style={{ fontSize: '12px', opacity: 0.7 }}>Tap to retry</p>
              </>
            ) : (
              <>
                <div className="loading-spinner" />
                <p>Starting camera...</p>
              </>
            )}
          </div>
        )}
      </div>
      <p className="scanner-hint">Point camera at a QR code</p>
    </div>
  )
}

// ========== HELPER FUNCTIONS ==========

/**
 * Validate Solana address (base58, 32-44 chars)
 */
function isValidSolanaAddress(str) {
  if (!str || typeof str !== 'string') return false
  
  // Solana addresses are 32-44 characters of base58
  if (str.length < 32 || str.length > 44) return false
  
  try {
    const decoded = decodeBase58(str)
    return decoded.length === 32
  } catch {
    return false
  }
}

/**
 * Parse QR code data - supports multiple formats
 */
function parseQRData(data) {
  if (!data || typeof data !== 'string') {
    return { type: 'unknown', raw: data }
  }
  
  const trimmed = data.trim()
  
  // Solana Pay format: solana:<address>?amount=<amount>&memo=<memo>
  if (trimmed.startsWith('solana:')) {
    const withoutProtocol = trimmed.replace('solana:', '')
    const [address, queryString] = withoutProtocol.split('?')
    const params = new URLSearchParams(queryString || '')
    
    return {
      type: 'solana-pay',
      address: address,
      amount: params.get('amount'),
      memo: params.get('memo'),
      splToken: params.get('spl-token')
    }
  }
  
  // Legacy h173k:// format
  if (trimmed.startsWith('h173k://')) {
    const withoutProtocol = trimmed.replace('h173k://', '')
    const [address, queryString] = withoutProtocol.split('?')
    const params = new URLSearchParams(queryString || '')
    
    return {
      type: 'h173k',
      address: address,
      amount: params.get('amount'),
      memo: params.get('memo')
    }
  }
  
  // Plain address
  if (isValidSolanaAddress(trimmed)) {
    return {
      type: 'address',
      address: trimmed
    }
  }
  
  return { type: 'unknown', raw: trimmed }
}

/**
 * Generate payment URL for QR (Solana Pay format)
 */
export function generatePaymentURL(address, amount = null, memo = null) {
  let url = `solana:${address}`
  const params = new URLSearchParams()
  
  if (amount) params.set('amount', amount.toString())
  if (memo) params.set('memo', memo)
  
  const paramStr = params.toString()
  if (paramStr) url += `?${paramStr}`
  
  return url
}

/**
 * Simple base58 decode
 */
function decodeBase58(str) {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const BASE = BigInt(58)
  
  let num = BigInt(0)
  for (const char of str) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) throw new Error('Invalid base58 character')
    num = num * BASE + BigInt(index)
  }
  
  const bytes = []
  while (num > 0) {
    bytes.unshift(Number(num % BigInt(256)))
    num = num / BigInt(256)
  }
  
  // Add leading zeros for '1' characters
  for (const char of str) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  
  return new Uint8Array(bytes)
}

// ========== CSS ==========
export const QR_STYLES = `
.qr-code-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: #ffffff;
  border-radius: 16px;
}

.qr-code-container canvas {
  border-radius: 8px;
}

.qr-scanner-container {
  position: relative;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
}

.scanner-viewport {
  position: relative;
  width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 16px;
  background: #000;
}

.scanner-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner-canvas {
  display: none;
}

.scanner-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.scanner-frame {
  width: 70%;
  height: 70%;
  border: 2px solid rgba(255, 255, 255, 0.8);
  border-radius: 16px;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  animation: scanPulse 2s ease-in-out infinite;
}

@keyframes scanPulse {
  0%, 100% { border-color: rgba(255, 255, 255, 0.5); }
  50% { border-color: rgba(255, 255, 255, 1); }
}

.scanner-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.8);
  color: rgba(255, 255, 255, 0.8);
  gap: 12px;
  cursor: pointer;
}

.scanner-hint {
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
  margin-top: 16px;
}

.qr-scanner-error {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.7);
}

.scanner-error-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.scanner-error-hint {
  font-size: 12px;
  opacity: 0.6;
  margin-top: 8px;
}
`
