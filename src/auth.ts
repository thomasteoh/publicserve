// src/auth.ts
import NextAuth from "next-auth"
import Nodemailer from "next-auth/providers/nodemailer"
import nodemailer from "nodemailer"
import { AzureTablesAdapter } from "@/lib/auth/adapter"
import { bootstrapFirstAdmin } from "@/lib/identity/bootstrap"
import { writeLog } from "@/lib/logging"

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
      async sendVerificationRequest({ identifier, url, provider: emailProvider }) {
        const { host } = new URL(url)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const transport = nodemailer.createTransport(emailProvider.server as any)
        await transport.sendMail({
          to: identifier,
          from: emailProvider.from,
          subject: `Sign in to ${host}`,
          text: `Sign in to ${host}\n\n${url}\n\n`,
          html: `<p>Sign in to <strong>${host}</strong></p><p><a href="${url}">Sign in</a></p>`,
        })
        writeLog("auth", "info", "verification email sent", { email: identifier })
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id
      return session
    },
  },
  events: {
    async signIn({ user }) {
      writeLog("auth", "info", "user signed in", {
        userId: user.id ?? undefined,
      })
    },
    async createUser({ user }) {
      writeLog("auth", "info", "new user created", {
        userId: user.id ?? undefined,
      })
      if (user.id) await bootstrapFirstAdmin(user.id)
    },
  },
})
