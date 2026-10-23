import { useEffect, useState } from 'react'

/** true while the app is on screen (document visible). */
export function usePageVisible() {
  const get = () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden')
  const [visible, setVisible] = useState(get)
  useEffect(() => {
    const on = () => setVisible(get())
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return visible
}
