import { motion } from 'framer-motion';

interface FlowBackgroundProps {
  className?: string;
  style?: React.CSSProperties;
}

const FlowBackground = ({ className = '', style }: FlowBackgroundProps) => {
  return (
    <div 
      className="fixed inset-0 w-screen h-screen overflow-hidden"
      style={{
        pointerEvents: 'none',
        zIndex: -1,
        ...style
      }}
    >
      {/* Base gradient background */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(circle at 20% 50%, rgba(20, 184, 166, 0.4) 0%, transparent 50%),
            radial-gradient(circle at 80% 20%, rgba(6, 182, 212, 0.3) 0%, transparent 50%),
            radial-gradient(circle at 40% 80%, rgba(34, 197, 94, 0.2) 0%, transparent 50%),
            linear-gradient(135deg, 
              rgba(15, 23, 42, 1) 0%, 
              rgba(30, 41, 59, 0.8) 25%,
              rgba(20, 184, 166, 0.4) 50%,
              rgba(6, 182, 212, 0.3) 75%,
              rgba(14, 116, 144, 0.6) 100%
            )
          `
        }}
      />

      {/* Large curved planet-like shape */}
      <motion.div
        className="absolute"
        style={{
          top: '10%',
          right: '15%',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: `
            radial-gradient(circle at 30% 40%, 
              rgba(251, 146, 60, 0.8) 0%,
              rgba(245, 101, 101, 0.6) 25%,
              rgba(14, 165, 233, 0.4) 50%,
              rgba(6, 182, 212, 0.3) 75%,
              transparent 100%
            )
          `,
          filter: 'blur(60px)',
        }}
        animate={{
          scale: [1, 1.05, 1],
          opacity: [0.8, 1, 0.8],
        }}
        transition={{
          duration: 8,
          repeat: Infinity,
          ease: "easeInOut"
        }}
      />

      {/* Secondary curved accent */}
      <motion.div
        className="absolute"
        style={{
          bottom: '20%',
          left: '10%',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: `
            radial-gradient(circle at 60% 30%, 
              rgba(20, 184, 166, 0.5) 0%,
              rgba(6, 182, 212, 0.3) 40%,
              transparent 70%
            )
          `,
          filter: 'blur(40px)',
        }}
        animate={{
          scale: [1, 1.08, 1],
          x: [-10, 10, -10],
        }}
        transition={{
          duration: 12,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 2
        }}
      />

      {/* Subtle overlay gradients for depth */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            linear-gradient(90deg, 
              rgba(15, 23, 42, 0.3) 0%, 
              transparent 30%,
              transparent 70%,
              rgba(6, 182, 212, 0.1) 100%
            )
          `
        }}
      />

      {/* Top light accent */}
      <motion.div
        className="absolute top-0 left-1/2 transform -translate-x-1/2"
        style={{
          width: '800px',
          height: '200px',
          background: `
            radial-gradient(ellipse at center, 
              rgba(14, 165, 233, 0.15) 0%,
              rgba(6, 182, 212, 0.1) 40%,
              transparent 70%
            )
          `,
          filter: 'blur(50px)',
        }}
        animate={{
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 6,
          repeat: Infinity,
          ease: "easeInOut",
          delay: 1
        }}
      />
    </div>
  );
};

export default FlowBackground;