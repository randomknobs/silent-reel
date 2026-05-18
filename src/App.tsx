import { UploadZone } from './components/UploadZone'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-5xl font-serif mb-2 tracking-wide">SILENT REEL</h1>
      <p className="text-neutral-500 text-sm mb-12 italic">
        Your moving picture, transformed.
      </p>
      <UploadZone onFile={(f) => console.log('got file', f)} />
    </div>
  )
}
