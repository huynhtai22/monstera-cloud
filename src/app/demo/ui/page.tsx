"use client";

import React from "react";
import Button from "@/components/ui/Button";
import CTAButton from "@/components/ui/CTAButton";
import Skeleton from "@/components/ui/Skeleton";
import Toast from "@/components/ui/Toast";

export default function DemoPage(){
  const [showToast, setShowToast] = React.useState(false);
  return (
    <div style={{ padding: 24 }}>
      <h1>UI Playground</h1>
      <section style={{ marginTop: 16 }}>
        <h2>Buttons</h2>
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="primary">Primary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" size="lg">Large</Button>
          <Button variant="primary" size="sm">Small</Button>
          <CTAButton onClick={() => setShowToast(true)}>CTA</CTAButton>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Skeleton</h2>
        <div style={{ width: 320 }}>
          <Skeleton height={20} rounded="6px" />
          <div style={{ height: 12 }} />
          <Skeleton height={14} width={240} rounded="6px" />
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Toast</h2>
        <button onClick={() => setShowToast(true)}>Show toast</button>
        <div style={{ position: 'fixed', right: 20, bottom: 20 }}>
          {showToast && <Toast open={showToast} onClose={() => setShowToast(false)}>Demo toast — saved</Toast>}
        </div>
      </section>
    </div>
  );
}
