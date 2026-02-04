'use client'

import { useMotionValue, useSpring } from 'framer-motion'
import { useEffect, useRef } from 'react'
import { formatPrice } from '@/lib/formatPrice'

interface CountUpProps {
  value: number
  className?: string
  style?: React.CSSProperties
}

/**
 * CountUp component with smooth spring-based animation.
 * Creates a "desk clock" effect where numbers interpolate smoothly
 * rather than blinking in and out of existence.
 */
export function CountUp({ value, className, style }: CountUpProps) {
  const motionValue = useMotionValue(value)
  const ref = useRef<HTMLSpanElement>(null)

  const spring = useSpring(motionValue, { damping: 30, stiffness: 100 })

  useEffect(() => {
    const currentValue = motionValue.get()
    if (currentValue !== value) {
      motionValue.set(value)
    }
  }, [value, motionValue])

  useEffect(() => {
    const unsubscribe = spring.on('change', (latest) => {
      if (ref.current) {
        ref.current.textContent = formatPrice(latest)
      }
    })
    return () => unsubscribe()
  }, [spring])

  return <span ref={ref} className={className} style={style} />
}
