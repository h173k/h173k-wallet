/**
 * H173K Wallet - QR Code Components
 * Scanner and Generator for addresses
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
        
        await QRCode.toCanvas(canvasRef.current, data, {
          width: size,
          margin: 2,
          color: {
            dark: '#ffffff',  // White QR code
            light: '#00000000'  // Transparent background
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
  
  const [scanning, setScanning] = useState(false)
  const [hasCamera, setHasCamera] = useState(true)
  const [error, setError] = useState(null)
  const [cameraReady, setCameraReady] = useState(false)
  
  // Load jsQR on mount
  useEffect(() => {
    import('jsqr').then(module => {
      jsQRRef.current = module.default
    }).catch(err => {
      console.error('Failed to load jsQR:', err)
      setError('Failed to load scanner')
    })
  }, [])
  
  // Start camera
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      })
      
      streamRef.current = stream
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play()
          setCameraReady(true)
          setScanning(true)
          setError(null)
        }
      }
    } catch (err) {
      console.error('Camera error:', err)
      setHasCamera(false)
      if (err.name === 'NotAllowedError') {
        setError('Camera access denied. Please allow camera access in your browser settings.')
      } else if (err.name === 'NotFoundError') {
        setError('No camera found on this device.')
      } else {
        setError('Unable to access camera: ' + err.message)
      }
      onError?.(err)
    }
  }, [facingMode, onError])
  
  // Stop camera
  const stopCamera = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current)
      animationRef.current = null
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    
    setScanning(false)
    setCameraReady(false)
  }, [])
  
  // Auto-start camera on mount
  useEffect(() => {
    startCamera()
    return () => stopCamera()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  
  // Scan for QR codes
  useEffect(() => {
    if (!scanning || !cameraReady || !videoRef.current || !canvasRef.current) return
    
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    
    const scan = () => {
      if (!jsQRRef.current || video.readyState !== video.HAVE_ENOUGH_DATA) {
        animationRef.current = requestAnimationFrame(scan)
        return
      }
      
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQRRef.current(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'dontInvert'
      })
      
      if (code) {
        // Validate it's a Solana address or our app URL
        const data = code.data
        const parsed = parseQRData(data)
        if (parsed.address && isValidSolanaAddress(parsed.address)) {
          stopCamera()
          onScan(parsed)
          return
        } else if (isValidSolanaAddress(data)) {
          stopCamera()
          onScan({ type: 'address', address: data })
          return
        }
      }
      
      animationRef.current = requestAnimationFrame(scan)
    }
    
    animationRef.current = requestAnimationFrame(scan)
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [scanning, cameraReady, onScan, stopCamera])
  
  if (!hasCamera || error) {
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
          playsInline 
          muted
          className="scanner-video"
        />
        <canvas ref={canvasRef} className="scanner-canvas" />
        <div className="scanner-overlay">
          <div className="scanner-frame" />
        </div>
        {!cameraReady && (
          <div className="scanner-loading">
            <div className="loading-spinner" />
            <p>Starting camera...</p>
          </div>
        )}
      </div>
      <p className="scanner-hint">Point camera at a QR code</p>
    </div>
  )
}

// ========== HELPER FUNCTIONS ==========

/**
 * Validate Solana address
 */
function isValidSolanaAddress(str) {
  try {
    // Check if it's a base58 encoded 32-byte address
    const decoded = decodeBase58(str)
    return decoded.length === 32
  } catch {
    return false
  }
}

/**
 * Check if it's a valid Solana Pay or H173K URL
 */
function isValidPaymentURL(str) {
  try {
    // Check for solana: protocol (Solana Pay)
    if (str.startsWith('solana:')) {
      const address = str.replace('solana:', '').split('?')[0]
      return isValidSolanaAddress(address)
    }
    // Legacy h173k: protocol
    if (str.startsWith('h173k:')) {
      const address = str.replace('h173k://', '').split('?')[0]
      return isValidSolanaAddress(address)
    }
    // Plain address
    return isValidSolanaAddress(str)
  } catch {
    return false
  }
}

/**
 * Parse QR code data
 */
function parseQRData(data) {
  // Solana Pay format: solana:<address>?amount=<amount>&memo=<memo>
  if (data.startsWith('solana:')) {
    const withoutProtocol = data.replace('solana:', '')
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
  if (data.startsWith('h173k://')) {
    const withoutProtocol = data.replace('h173k://', '')
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
  if (isValidSolanaAddress(data)) {
    return {
      type: 'address',
      address: data
    }
  }
  
  return { type: 'unknown', raw: data }
}

/**
 * Generate payment URL for QR
 */
/**
 * Generate payment URL for QR (Solana Pay format)
 * https://docs.solanapay.com/spec
 */
export function generatePaymentURL(address, amount = null, memo = null) {
  // Solana Pay format: solana:<recipient>?amount=<amount>&spl-token=<mint>&memo=<memo>
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
  
  // Add leading zeros
  for (const char of str) {
    if (char !== '1') break
    bytes.unshift(0)
  }
  
  return new Uint8Array(bytes)
}

// ========== CSS (to be added to App.css) ==========
export const QR_STYLES = `
.qr-code-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(255, 255, 255, 0.05);
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

.scanner-stop {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
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
