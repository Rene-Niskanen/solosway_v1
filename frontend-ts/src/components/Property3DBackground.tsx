import { Canvas } from '@react-three/fiber';
import { useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { motion } from 'framer-motion';

// Individual building component with complex geometry
function Building({ position, scale, rotationSpeed, morphing = false }: {
  position: [number, number, number];
  scale: [number, number, number];
  rotationSpeed: number;
  morphing?: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireframeRef = useRef<THREE.LineSegments>(null);
  
  // Create complex building geometry
  const geometry = useMemo(() => {
    // Create a more complex building using BoxGeometry with segments
    const mainBuilding = new THREE.BoxGeometry(1, 2, 1, 4, 8, 4);
    return mainBuilding;
  }, []);

  // Create wireframe geometry
  const wireframeGeometry = useMemo(() => {
    const edges = new THREE.EdgesGeometry(geometry);
    return edges;
  }, [geometry]);

  useFrame((state) => {
    if (meshRef.current && wireframeRef.current) {
      // Rotation animation
      meshRef.current.rotation.y += rotationSpeed;
      wireframeRef.current.rotation.y += rotationSpeed;
      
      // Morphing animation for some buildings
      if (morphing) {
        const time = state.clock.elapsedTime;
        const scaleY = 1 + Math.sin(time * 0.5) * 0.2;
        meshRef.current.scale.y = scaleY;
        wireframeRef.current.scale.y = scaleY;
        
        // Subtle breathing effect
        const breathe = 1 + Math.sin(time * 2) * 0.05;
        meshRef.current.scale.x = breathe;
        meshRef.current.scale.z = breathe;
        wireframeRef.current.scale.x = breathe;
        wireframeRef.current.scale.z = breathe;
      }
    }
  });

  return (
    <group position={position} scale={scale}>
      {/* Invisible mesh for shadows/depth */}
      <mesh ref={meshRef} geometry={geometry}>
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      
      {/* Wireframe visualization */}
      <lineSegments ref={wireframeRef} geometry={wireframeGeometry}>
        <lineBasicMaterial color="white" transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
}

// Complex skyscraper with multiple sections
function Skyscraper({ position, rotationSpeed }: {
  position: [number, number, number];
  rotationSpeed: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  
  const sections = useMemo(() => [
    { height: 1.5, width: 1.2, depth: 1.2, y: 0 },
    { height: 1.0, width: 1.0, depth: 1.0, y: 1.5 },
    { height: 0.8, width: 0.8, depth: 0.8, y: 2.5 },
    { height: 0.4, width: 0.6, depth: 0.6, y: 3.3 },
  ], []);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += rotationSpeed;
      
      // Wave effect through building sections
      const time = state.clock.elapsedTime;
      groupRef.current.children.forEach((child, index) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          const offset = index * 0.3;
          child.rotation.x = Math.sin(time + offset) * 0.1;
        }
      });
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {sections.map((section, index) => {
        const geometry = new THREE.BoxGeometry(section.width, section.height, section.depth);
        const wireframeGeometry = new THREE.EdgesGeometry(geometry);
        
        return (
          <group key={index} position={[0, section.y, 0]}>
            <lineSegments geometry={wireframeGeometry}>
              <lineBasicMaterial 
                color="white" 
                transparent 
                opacity={0.7 - index * 0.1} 
              />
            </lineSegments>
          </group>
        );
      })}
    </group>
  );
}

// Bridge/connection structure
function Bridge({ position }: { position: [number, number, number] }) {
  const bridgeRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (bridgeRef.current) {
      const time = state.clock.elapsedTime;
      bridgeRef.current.position.y = position[1] + Math.sin(time) * 0.05;
    }
  });

  return (
    <group ref={bridgeRef} position={position}>
      {/* Main bridge structure */}
      <lineSegments>
        <cylinderGeometry args={[0.05, 0.05, 2, 8]} />
        <lineBasicMaterial color="white" transparent opacity={0.5} />
      </lineSegments>
      
      {/* Support cables */}
      {Array.from({ length: 8 }, (_, i) => (
        <lineSegments key={i} position={[-1 + i * 0.25, 0, 0]} rotation={[0, 0, Math.PI / 4]}>
          <cylinderGeometry args={[0.01, 0.01, 0.5, 4]} />
          <lineBasicMaterial color="white" transparent opacity={0.3} />
        </lineSegments>
      ))}
    </group>
  );
}

// Main 3D scene component
function CityScene() {
  const groupRef = useRef<THREE.Group>(null);
  
  useFrame((state) => {
    if (groupRef.current) {
      // Gentle overall rotation of the entire city
      groupRef.current.rotation.y += 0.001;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Left building complex */}
      <Building 
        position={[-4, -1, -2]} 
        scale={[0.8, 1.2, 0.8]} 
        rotationSpeed={0.005}
        morphing={true}
      />
      <Building 
        position={[-3, -1, -1]} 
        scale={[0.6, 0.8, 0.6]} 
        rotationSpeed={-0.003}
      />
      
      {/* Center skyscraper complex */}
      <Skyscraper position={[0, -1, 0]} rotationSpeed={0.002} />
      <Building 
        position={[1.5, -1, -0.5]} 
        scale={[0.7, 1.5, 0.7]} 
        rotationSpeed={0.004}
        morphing={true}
      />
      
      {/* Right building complex */}
      <Building 
        position={[4, -1, -1]} 
        scale={[0.9, 1.1, 0.9]} 
        rotationSpeed={-0.006}
      />
      <Building 
        position={[3.5, -1, 1]} 
        scale={[0.5, 0.9, 0.5]} 
        rotationSpeed={0.008}
        morphing={true}
      />
      
      {/* Connecting bridges */}
      <Bridge position={[2, 0.5, -0.5]} />
      <Bridge position={[-1, 0.8, 0]} />
      
      {/* Background smaller buildings */}
      {Array.from({ length: 6 }, (_, i) => (
        <Building
          key={i}
          position={[
            -6 + i * 2.4,
            -1.5,
            -4 + Math.sin(i) * 2
          ]}
          scale={[0.3, 0.4 + Math.random() * 0.4, 0.3]}
          rotationSpeed={(Math.random() - 0.5) * 0.01}
          morphing={i % 3 === 0}
        />
      ))}
    </group>
  );
}

// Main component
export const Property3DBackground = () => {
  return (
    <div className="fixed inset-0 overflow-hidden" style={{ zIndex: -10 }}>
      {/* Sky gradient background - keeping your preferred colors */}
      <div className="absolute inset-0 bg-gradient-to-b from-sky-400/60 via-sky-300/50 to-sky-200/40" />
      
      {/* Animated clouds */}
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

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 2, 8], fov: 60 }}
        style={{ background: 'transparent' }}
      >
        {/* Lighting */}
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 10, 5]} intensity={0.5} color="white" />
        <pointLight position={[-5, 5, 5]} intensity={0.3} color="lightblue" />
        
        {/* City scene */}
        <CityScene />
        
        {/* Fog for depth */}
        <fog attach="fog" args={['lightblue', 8, 20]} />
      </Canvas>
      
      {/* Subtle overlay for depth */}
      <div className="absolute inset-0 bg-gradient-to-t from-white/5 via-transparent to-transparent" />
    </div>
  );
};
