import React from 'react';
import { Video } from '../types/index.ts';

interface ProcessingStatusCardProps {
  video?: Video;
  onReady?: () => void;
}

// این کارت طبق درخواست به طور کامل از سایت حذف شده است
export const ProcessingStatusCard: React.FC<ProcessingStatusCardProps> = () => {
  return null;
};
