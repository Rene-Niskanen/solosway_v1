import { motion } from "framer-motion";

export const PropertyOutlineBackground = () => {
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: -10 }}>
      {/* Sky gradient background */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-400/60 via-sky-300/50 to-sky-200/40" />
      
      {/* Cloud shapes */}
      <div className="absolute inset-0">
        <motion.div 
          className="absolute top-10 left-1/4 w-32 h-16 bg-white/20 rounded-full blur-sm"
          animate={{ x: [0, 20, 0], opacity: [0.2, 0.3, 0.2] }}
          transition={{ duration: 20, repeat: Infinity }}
        />
        <motion.div 
          className="absolute top-20 right-1/3 w-48 h-20 bg-white/15 rounded-full blur-sm"
          animate={{ x: [0, -15, 0], opacity: [0.15, 0.25, 0.15] }}
          transition={{ duration: 25, repeat: Infinity }}
        />
        <motion.div 
          className="absolute top-16 left-2/3 w-24 h-12 bg-white/25 rounded-full blur-sm"
          animate={{ x: [0, 10, 0], opacity: [0.25, 0.35, 0.25] }}
          transition={{ duration: 18, repeat: Infinity }}
        />
      </div>

      {/* Property outline buildings */}
      <svg 
        className="absolute inset-0 w-full h-full" 
        viewBox="0 0 1920 1080" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Building Complex 1 - Left side */}
        <g className="opacity-70" style={{ filter: "drop-shadow(0 0 2px rgba(255,255,255,0.3))" }}>
          {/* Tall tower */}
          <motion.path
            d="M120 400 L120 1080 L220 1080 L220 400 Z"
            stroke="white"
            strokeWidth="2.5"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 3, delay: 0.5 }}
          />
          {/* Windows for tall tower */}
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ duration: 2, delay: 2 }}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} x={140} y={420 + i * 50} width={20} height={30} stroke="white" strokeWidth="1.2" fill="none" />
            ))}
            {Array.from({ length: 12 }, (_, i) => (
              <rect key={i} x={180} y={420 + i * 50} width={20} height={30} stroke="white" strokeWidth="1.2" fill="none" />
            ))}
          </motion.g>

          {/* Medium building */}
          <motion.path
            d="M240 550 L240 1080 L320 1080 L320 550 Z"
            stroke="white"
            strokeWidth="2.2"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.7 }}
            transition={{ duration: 2.5, delay: 1 }}
          />
        </g>

        {/* Building Complex 2 - Center */}
        <g className="opacity-90" style={{ filter: "drop-shadow(0 0 4px rgba(255,255,255,0.4))" }}>
          {/* Main skyscraper */}
          <motion.path
            d="M800 200 L800 1080 L950 1080 L950 200 Z"
            stroke="white"
            strokeWidth="3.5"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.9 }}
            transition={{ duration: 4, delay: 0.2 }}
          />
          
          {/* Geometric details */}
          <motion.g
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            transition={{ duration: 3, delay: 2.5 }}
          >
            {Array.from({ length: 15 }, (_, i) => (
              <g key={i}>
                <rect x={820} y={220 + i * 55} width={25} height={35} stroke="white" strokeWidth="1.3" fill="none" />
                <rect x={855} y={220 + i * 55} width={25} height={35} stroke="white" strokeWidth="1.3" fill="none" />
                <rect x={890} y={220 + i * 55} width={25} height={35} stroke="white" strokeWidth="1.3" fill="none" />
              </g>
            ))}
          </motion.g>

          {/* Adjacent building */}
          <motion.path
            d="M970 350 L970 1080 L1100 1080 L1100 350 Z"
            stroke="white"
            strokeWidth="3"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.9 }}
            transition={{ duration: 3, delay: 1.2 }}
          />
        </g>

        {/* Building Complex 3 - Right side */}
        <g className="opacity-75" style={{ filter: "drop-shadow(0 0 3px rgba(255,255,255,0.35))" }}>
          {/* Bridge/connection structure */}
          <motion.path
            d="M1400 500 L1600 500 M1400 520 L1600 520 M1400 500 L1400 520 M1600 500 L1600 520"
            stroke="white"
            strokeWidth="2.5"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.75 }}
            transition={{ duration: 2, delay: 2 }}
          />

          {/* Tower with angled top */}
          <motion.path
            d="M1620 450 L1620 1080 L1750 1080 L1750 450 L1685 380 Z"
            stroke="white"
            strokeWidth="3"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.75 }}
            transition={{ duration: 3.5, delay: 1.5 }}
          />

          {/* Smaller connecting buildings */}
          <motion.path
            d="M1380 600 L1380 1080 L1420 1080 L1420 600 Z"
            stroke="white"
            strokeWidth="2.2"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.65 }}
            transition={{ duration: 2, delay: 2.8 }}
          />
        </g>

        {/* Additional architectural elements */}
        <g className="opacity-40" style={{ filter: "drop-shadow(0 0 1px rgba(255,255,255,0.2))" }}>
          {/* Background buildings silhouettes */}
          <motion.path
            d="M50 700 L50 1080 L80 1080 L80 700 Z M90 750 L90 1080 L110 1080 L110 750 Z"
            stroke="white"
            strokeWidth="1.5"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.3 }}
            transition={{ duration: 2, delay: 3.5 }}
          />
          
          <motion.path
            d="M1800 650 L1800 1080 L1850 1080 L1850 650 Z M1860 700 L1860 1080 L1890 1080 L1890 700 Z"
            stroke="white"
            strokeWidth="1.5"
            fill="none"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.3 }}
            transition={{ duration: 2, delay: 4 }}
          />
        </g>

        {/* Floating geometric elements for depth */}
        <g className="opacity-25">
          <motion.circle
            cx="600"
            cy="300"
            r="3"
            stroke="white"
            strokeWidth="1"
            fill="none"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.25 }}
            transition={{ duration: 1.5, delay: 4.5 }}
          />
          <motion.rect
            x="1200"
            y="250"
            width="8"
            height="8"
            stroke="white"
            strokeWidth="0.8"
            fill="none"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.25 }}
            transition={{ duration: 1.5, delay: 5 }}
          />
        </g>
      </svg>

      {/* Subtle overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-white/5 via-transparent to-transparent" />
    </div>
  );
};