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

  // Spring configuration for smooth, mechanical feel
  // Higher damping = smoother/slower, higher stiffness = faster/springier
  const spring = useSpring(motionValue, {
    damping: 30,
    stiffness: 100,
  })

  // Update the motion value when the price changes
  useEffect(() => {
    motionValue.set(value)
  }, [value, motionValue])

  // Update the DOM with formatted numbers as the spring animates
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
