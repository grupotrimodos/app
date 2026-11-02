import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grupo Trimodos",
  description: "App interna de Grupo Trimodos",
  robots: { index: false, follow: false },
  icons: { icon: "/deca/favicon.png", apple: "/deca/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = { themeColor: "#121417", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
