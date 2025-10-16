"use client";

import * as React from "react";
import { motion } from "framer-motion";
export interface CloudBackgroundProps {
  className?: string;
  intensity?: "subtle" | "medium" | "prominent";
  interactive?: boolean;
}
export const CloudBackground = ({
  className,
  intensity = "subtle",
  interactive = true
}: CloudBackgroundProps) => {
  const [mousePosition, setMousePosition] = React.useState({
    x: 0,
    y: 0
  });
  const [isHovered, setIsHovered] = React.useState(false);
  const handleMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setMousePosition({
      x,
      y
    });
  }, [interactive]);
  const getIntensityValues = () => {
    switch (intensity) {
      case "prominent":
        return {
          opacity: 0.15,
          blur: "60px",
          scale: 1.2,
          moveRange: 25
        };
      case "medium":
        return {
          opacity: 0.08,
          blur: "80px",
          scale: 1.1,
          moveRange: 15
        };
      default:
        return {
          opacity: 0.04,
          blur: "100px",
          scale: 1.05,
          moveRange: 10
        };
    }
  };
  const {
    opacity,
    blur,
    scale,
    moveRange
  } = getIntensityValues();
  const cloudVariants = {
    initial: {
      opacity: 0,
      scale: 0.8
    },
    animate: {
      opacity: opacity,
      scale: scale,
      transition: {
        duration: 2,
        ease: [0.23, 1, 0.32, 1] as const
      }
    },
    hover: {
      opacity: opacity * 1.5,
      scale: scale * 1.02,
      transition: {
        duration: 0.8,
        ease: [0.23, 1, 0.32, 1] as const
      }
    }
  };
  const getCloudPath = (variant: number) => {
    const paths = [
    // Cloud 1 - Soft, rounded
    "M100,200 C100,150 150,100 200,100 C250,100 300,150 300,200 C350,200 400,250 400,300 C400,350 350,400 300,400 L200,400 C150,400 100,350 100,300 Z",
    // Cloud 2 - More organic
    "M150,180 C120,140 160,100 220,110 C280,90 340,130 360,180 C400,170 440,200 430,240 C440,280 400,310 360,300 C340,340 280,350 220,330 C160,340 120,300 130,260 C100,240 120,200 150,180 Z",
    // Cloud 3 - Elongated
    "M80,250 C80,200 120,160 170,160 C220,160 260,180 300,160 C350,160 400,200 420,250 C440,280 420,320 380,340 C340,360 300,350 260,360 C220,370 180,350 140,360 C100,350 80,300 80,250 Z",
    // Cloud 4 - Compact
    "M200,150 C170,120 210,80 260,90 C310,80 350,120 340,170 C380,180 400,220 380,260 C360,300 320,310 280,300 C240,310 200,280 210,240 C170,230 180,190 200,150 Z"];
    return paths[variant % paths.length];
  };
  return <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className || ''}`} onMouseMove={handleMouseMove} onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)} style={{
    pointerEvents: interactive ? 'auto' : 'none'
  }}>
      {/* Primary cloud layer */}
      <motion.div className="absolute inset-0" variants={cloudVariants} initial="initial" animate={isHovered ? "hover" : "animate"}>
        {/* Cloud 1 - Top left */}
        <motion.svg className="absolute" style={{
        top: "10%",
        left: "15%",
        width: "300px",
        height: "200px",
        filter: `blur(${blur})`
      }} animate={{
        x: interactive ? mousePosition.x * moveRange - moveRange / 2 : 0,
        y: interactive ? mousePosition.y * moveRange / 2 - moveRange / 4 : 0,
        rotate: [0, 2, 0],
        scale: [1, 1.02, 1]
      }} transition={{
        x: {
          duration: 0.8,
          ease: "easeOut"
        },
        y: {
          duration: 0.8,
          ease: "easeOut"
        },
        rotate: {
          duration: 20,
          repeat: Infinity,
          ease: "easeInOut"
        },
        scale: {
          duration: 15,
          repeat: Infinity,
          ease: "easeInOut"
        }
      }}>
          <path d={getCloudPath(0)} fill="url(#gradient1)" opacity={0.6} />
          <defs>
            <radialGradient id="gradient1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#E0F2FE" />
              <stop offset="50%" stopColor="#BAE6FD" />
              <stop offset="100%" stopColor="#7DD3FC" />
            </radialGradient>
          </defs>
        </motion.svg>

        {/* Cloud 2 - Top right */}
        <motion.svg className="absolute" style={{
        top: "20%",
        right: "10%",
        width: "280px",
        height: "180px",
        filter: `blur(${blur})`
      }} animate={{
        x: interactive ? -mousePosition.x * moveRange / 1.5 + moveRange / 3 : 0,
        y: interactive ? mousePosition.y * moveRange / 3 - moveRange / 6 : 0,
        rotate: [0, -1.5, 0],
        scale: [1, 1.03, 1]
      }} transition={{
        x: {
          duration: 1,
          ease: "easeOut"
        },
        y: {
          duration: 1,
          ease: "easeOut"
        },
        rotate: {
          duration: 25,
          repeat: Infinity,
          ease: "easeInOut"
        },
        scale: {
          duration: 18,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 3
        }
      }}>
          <path d={getCloudPath(1)} fill="url(#gradient2)" opacity={0.5} />
          <defs>
            <radialGradient id="gradient2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F0F9FF" />
              <stop offset="50%" stopColor="#E0F2FE" />
              <stop offset="100%" stopColor="#BAE6FD" />
            </radialGradient>
          </defs>
        </motion.svg>

        {/* Cloud 3 - Bottom left */}
        <motion.svg className="absolute" style={{
        bottom: "15%",
        left: "20%",
        width: "320px",
        height: "160px",
        filter: `blur(${blur})`
      }} animate={{
        x: interactive ? mousePosition.x * moveRange / 2 - moveRange / 4 : 0,
        y: interactive ? -mousePosition.y * moveRange / 2 + moveRange / 4 : 0,
        rotate: [0, 1, 0],
        scale: [1, 1.01, 1]
      }} transition={{
        x: {
          duration: 1.2,
          ease: "easeOut"
        },
        y: {
          duration: 1.2,
          ease: "easeOut"
        },
        rotate: {
          duration: 30,
          repeat: Infinity,
          ease: "easeInOut"
        },
        scale: {
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 6
        }
      }}>
          <path d={getCloudPath(2)} fill="url(#gradient3)" opacity={0.4} />
          <defs>
            <radialGradient id="gradient3" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FEFCE8" />
              <stop offset="50%" stopColor="#FEF3C7" />
              <stop offset="100%" stopColor="#FDE68A" />
            </radialGradient>
          </defs>
        </motion.svg>

        {/* Cloud 4 - Center right */}
        <motion.svg className="absolute" style={{
        top: "45%",
        right: "25%",
        width: "250px",
        height: "150px",
        filter: `blur(${blur})`
      }} animate={{
        x: interactive ? -mousePosition.x * moveRange / 3 + moveRange / 6 : 0,
        y: interactive ? mousePosition.y * moveRange / 4 - moveRange / 8 : 0,
        rotate: [0, -0.8, 0],
        scale: [1, 1.04, 1]
      }} transition={{
        x: {
          duration: 0.9,
          ease: "easeOut"
        },
        y: {
          duration: 0.9,
          ease: "easeOut"
        },
        rotate: {
          duration: 35,
          repeat: Infinity,
          ease: "easeInOut"
        },
        scale: {
          duration: 16,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 9
        }
      }}>
          <path d={getCloudPath(3)} fill="url(#gradient4)" opacity={0.3} />
          <defs>
            <radialGradient id="gradient4" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F3E8FF" />
              <stop offset="50%" stopColor="#E9D5FF" />
              <stop offset="100%" stopColor="#D8B4FE" />
            </radialGradient>
          </defs>
        </motion.svg>
      </motion.div>

      {/* Secondary subtle layer for depth */}
      <motion.div className="absolute inset-0" initial={{
      opacity: 0
    }} animate={{
      opacity: opacity * 0.3
    }} transition={{
      duration: 3,
      delay: 1
    }}>
        {/* Ambient glow effects */}
        <motion.div className="absolute w-96 h-96 rounded-full" style={{
        top: "30%",
        left: "40%",
        background: "radial-gradient(circle, rgba(147, 197, 253, 0.02) 0%, transparent 70%)",
        filter: "blur(120px)"
      }} animate={{
        scale: [1, 1.1, 1],
        opacity: [0.3, 0.5, 0.3]
      }} transition={{
        duration: 12,
        repeat: Infinity,
        ease: "easeInOut"
      }} />

        <motion.div className="absolute w-80 h-80 rounded-full" style={{
        bottom: "20%",
        right: "30%",
        background: "radial-gradient(circle, rgba(196, 181, 253, 0.015) 0%, transparent 70%)",
        filter: "blur(100px)"
      }} animate={{
        scale: [1, 1.08, 1],
        opacity: [0.2, 0.4, 0.2]
      }} transition={{
        duration: 16,
        repeat: Infinity,
        ease: "easeInOut",
        delay: 4
      }} />
      </motion.div>

      {/* Interactive particle effects */}
      {interactive && isHovered && <motion.div className="absolute inset-0" initial={{
      opacity: 0
    }} animate={{
      opacity: 1
    }} exit={{
      opacity: 0
    }} transition={{
      duration: 0.5
    }}>
          {[...Array(6)].map((_, i) => <motion.div key={i} className="absolute w-1 h-1 bg-blue-200/40 rounded-full" style={{
        left: `${20 + i * 12}%`,
        top: `${30 + i % 3 * 20}%`,
        filter: "blur(1px)"
      }} animate={{
        y: [-5, 5, -5],
        x: [-3, 3, -3],
        opacity: [0.2, 0.6, 0.2],
        scale: [0.8, 1.2, 0.8]
      }} transition={{
        duration: 3 + i * 0.5,
        repeat: Infinity,
        ease: "easeInOut",
        delay: i * 0.3
      }} />)}
        </motion.div>}
    </div>;
};