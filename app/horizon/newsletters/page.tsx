import { Newsletters } from "@/components/ans/newsletters";
import { NEWSLETTERS } from "@/lib/ans/demo-data";

export const metadata = { title: "Newsletters · Horizon Scan" };

export default function NewslettersPage() {
  return <Newsletters newsletters={NEWSLETTERS} />;
}
