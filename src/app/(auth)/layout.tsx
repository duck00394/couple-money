import { APP } from "@/config/app";
import { ArtIcon } from "@/components/ArtIcon";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-brand-100 text-brand-700 shadow-sm"><ArtIcon name="couple" size={30} /></div>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-stone-800">{APP.name}</h1>
        <p className="mt-1 text-sm text-stone-500">{APP.tagline}</p>
      </div>
      <div className="rounded-3xl bg-white p-5 shadow-sm">{children}</div>
    </main>
  );
}
