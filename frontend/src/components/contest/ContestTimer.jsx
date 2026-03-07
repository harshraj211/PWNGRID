import { useEffect, useState } from 'react'

export const ContestTimer = ({ startTime, endTime }) => {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      const end = new Date(endTime)
      const diff = end - now
      if (diff > 0) {
        const hours = Math.floor(diff / (1000 * 60 * 60))
        const minutes = Math.floor((diff / (1000 * 60)) % 60)
        setTimeLeft(`${hours}h ${minutes}m`)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [endTime])

  return <div className="contest-timer">{timeLeft}</div>
}
