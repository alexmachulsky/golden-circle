export interface WhySection {
  statement: string;
  depth_note: string;
}

export interface HowItem {
  title: string;
  description: string;
  uniqueness: string;
}

export interface WhatItem {
  title: string;
  description: string;
  why_connection: string;
}

export interface AnalysisResult {
  why: WhySection;
  how: HowItem[];
  what: WhatItem[];
  positioning_note: string;
}

export type ActiveSection = 'why' | 'how' | 'what' | null;
