"use client";

import React from 'react';

export function DataStreamBackground() {
    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {/* Inline styles for the SVG dash animations */}
            <style>
                {`
                    @keyframes slideNetwork {
                        0% { stroke-dashoffset: 1200; opacity: 0; }
                        5% { opacity: 0; }
                        15% { opacity: 1; }
                        85% { opacity: 1; }
                        95% { opacity: 0; }
                        100% { stroke-dashoffset: -1200; opacity: 0; }
                    }
                    .stream-path-1 { animation: slideNetwork 6s cubic-bezier(0.4, 0, 0.2, 1) infinite; stroke-dasharray: 150 1200; }
                    .stream-path-2 { animation: slideNetwork 8s cubic-bezier(0.4, 0, 0.2, 1) infinite 1.5s; stroke-dasharray: 200 1200; }
                    .stream-path-3 { animation: slideNetwork 7s cubic-bezier(0.4, 0, 0.2, 1) infinite 3s; stroke-dasharray: 100 1200; }
                    .stream-path-4 { animation: slideNetwork 9s cubic-bezier(0.4, 0, 0.2, 1) infinite 0.5s; stroke-dasharray: 180 1200; }
                    .stream-path-5 { animation: slideNetwork 6.5s cubic-bezier(0.4, 0, 0.2, 1) infinite 2s; stroke-dasharray: 130 1200; }
                `}
            </style>

            <svg 
                className="absolute inset-0 w-full h-full opacity-60" 
                viewBox="0 0 1200 800" 
                preserveAspectRatio="xMidYMid slice" 
                xmlns="http://www.w3.org/2000/svg"
            >
                {/* SVG Definitions for Gradients */}
                <defs>
                    <linearGradient id="stream-emerald" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="transparent" />
                        <stop offset="50%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                    <linearGradient id="stream-blue" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="transparent" />
                        <stop offset="50%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                    <linearGradient id="stream-white" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="transparent" />
                        <stop offset="50%" stopColor="#ffffff" stopOpacity="0.8" />
                        <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                </defs>

                <g className="opacity-20 stroke-white/20" fill="none" strokeWidth="1">
                    {/* Underlying static structural paths */}
                    <path d="M-100,200 C300,300 600,-100 1300,400" />
                    <path d="M-100,500 C400,600 800,100 1300,300" />
                    <path d="M-100,700 C200,800 500,300 1300,500" />
                    <path d="M100,-100 C300,200 800,800 1000,900" />
                    <path d="M400,-100 C600,300 1100,600 1300,800" />
                </g>

                <g fill="none" strokeWidth="2" strokeLinecap="round">
                    {/* Animated glowing data streams riding over the base paths */}
                    {/* Path 1 */}
                    <path d="M-100,200 C300,300 600,-100 1300,400" stroke="url(#stream-emerald)" className="stream-path-1" />
                    
                    {/* Path 2 */}
                    <path d="M-100,500 C400,600 800,100 1300,300" stroke="url(#stream-blue)" className="stream-path-2" />
                    
                    {/* Path 3 */}
                    <path d="M-100,700 C200,800 500,300 1300,500" stroke="url(#stream-emerald)" className="stream-path-3" />
                    
                    {/* Path 4 */}
                    <path d="M100,-100 C300,200 800,800 1000,900" stroke="url(#stream-white)" className="stream-path-4" />
                    
                    {/* Path 5 */}
                    <path d="M400,-100 C600,300 1100,600 1300,800" stroke="url(#stream-emerald)" className="stream-path-5" />
                </g>

                {/* Simulated processing active "nodes" at intersections */}
                <g className="fill-emerald-500" opacity="0.3">
                    <circle cx="280" cy="285" r="3" className="animate-pulse" />
                    <circle cx="680" cy="200" r="4" className="animate-ping" style={{ animationDuration: '3s' }} />
                    <circle cx="450" cy="460" r="2.5" className="animate-pulse" />
                    <circle cx="850" cy="520" r="3" className="animate-pulse" style={{ animationDelay: '1s' }} />
                    <circle cx="950" cy="380" r="3" className="animate-pulse" style={{ animationDelay: '2s' }} />
                </g>
            </svg>
        </div>
    );
}
