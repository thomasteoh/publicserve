// src/auth.ts
import NextAuth from "next-auth"
import Nodemailer from "next-auth/providers/nodemailer"
import { AzureTablesAdapter } from "@/lib/auth/adapter"
import { bootstrapFirstAdmin } from "@/lib/identity/bootstrap"

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: AzureTablesAdapter(),
  session: { strategy: "database" },
  providers: [
    Nodemailer({
      server: {
        host: process.env.SMTP_HOST!,
        port: Number(process.env.SMTP_PORT ?? 587),
        auth: {
          user: process.env.SMTP_USER!,
          pass: process.env.SMTP_PASSWORD!,
        },
      },
      from: process.env.SMTP_FROM!,
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
  events: {
    async createUser({ user }) {
      if (user.id) await bootstrapFirstAdmin(user.id)
    },
  },
})
