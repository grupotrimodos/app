import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./shell.css";

export const metadata: Metadata = {
  title: "Grupo Trimodos",
  description: "App interna de Grupo Trimodos",
  robots: { index: false, follow: false },
  icons: { icon: "/deca/favicon.png", apple: "/deca/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#152636", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
