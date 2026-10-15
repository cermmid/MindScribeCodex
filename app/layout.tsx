import type { Metadata } from "next";
export const metadata:Metadata={title:"MindScribe",description:"Prosty zapis wizyty — wersja testowa",robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="pl"><body>{children}</body></html>; }
