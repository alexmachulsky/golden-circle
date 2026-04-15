import GoldenCircleApp from '@/components/GoldenCircleApp';
import { getTurnstileSiteKey } from '@/lib/turnstile';

export default function Home() {
  return <GoldenCircleApp turnstileSiteKey={getTurnstileSiteKey()} />;
}
