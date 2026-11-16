import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AuthUser, UserRole } from '../types/pothsheba.ts';

interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  salt: string;
  passwordHash: string;
  createdAt: string;
}

interface StoredSession {
  token: string;
  userId: string;
  expiresAt: number;
}

interface AuthDb {
  users: StoredUser[];
  sessions: StoredSession[];
  reportOwnership: Record<string, string[]>;
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHex: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export class AuthStore {
  private authFile: string;
  private dataDir: string;
  private db: AuthDb;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.authFile = path.join(dataDir, 'pothsheba-auth.json');
    this.db = this.load();
    this.ensureSeedAccounts();
  }

  private load(): AuthDb {
    try {
      if (fs.existsSync(this.authFile)) {
        const parsed = JSON.parse(fs.readFileSync(this.authFile, 'utf-8')) as AuthDb;
        if (Array.isArray(parsed.users) && Array.isArray(parsed.sessions)) {
          return {
            users: parsed.users,
            sessions: parsed.sessions.filter((s) => s.expiresAt > Date.now()),
            reportOwnership: parsed.reportOwnership ?? {},
          };
        }
      }
    } catch (err) {
      console.warn('Could not load auth store, initializing fresh:', err);
    }
    return { users: [], sessions: [], reportOwnership: {} };
  }

  private save(): void {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      fs.writeFileSync(this.authFile, JSON.stringify(this.db, null, 2), 'utf-8');
    } catch (err) {
      console.warn('Skipping auth store disk write:', err);
    }
  }

  private ensureSeedAccounts(): void {
    const adminEmail = (process.env.ADMIN_EMAIL || 'officer@pothsheba.local').trim().toLowerCase();
    const adminPass = process.env.ADMIN_PASSWORD || 'officer123';
    const citizenEmail = 'citizen@pothsheba.local';
    const citizenPass = 'citizen123';

    let changed = false;

    if (!this.db.users.some((u) => u.email === adminEmail)) {
      const salt = crypto.randomBytes(16).toString('hex');
      this.db.users.push({
        id: 'USR-ADMIN-01',
        name: 'Pilot Authority Officer',
        email: adminEmail,
        role: 'admin',
        salt,
        passwordHash: hashPassword(adminPass, salt),
        createdAt: new Date().toISOString(),
      });
      changed = true;
    }

    if (!this.db.users.some((u) => u.email === citizenEmail)) {
      const salt = crypto.randomBytes(16).toString('hex');
      this.db.users.push({
        id: 'USR-CIT-01',
        name: 'Pilot Citizen',
        email: citizenEmail,
        role: 'user',
        salt,
        passwordHash: hashPassword(citizenPass, salt),
        createdAt: new Date().toISOString(),
      });
      this.db.reportOwnership['USR-CIT-01'] = ['PS-001', 'PS-005'];
      changed = true;
    }

    if (changed) {
      this.save();
    }
  }

  private issueSession(user: StoredUser): { token: string; user: AuthUser } {
    const token = crypto.randomBytes(32).toString('hex');
    this.db.sessions = this.db.sessions.filter((s) => s.expiresAt > Date.now());
    this.db.sessions.push({
      token,
      userId: user.id,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    this.save();
    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    };
  }

  public registerCitizen(
    name: string,
    emailRaw: string,
    password: string
  ): { ok: true; session: { token: string; user: AuthUser } } | { ok: false; error: string } {
    const email = emailRaw.trim().toLowerCase();
    const cleanName = name.trim();
    if (!cleanName || cleanName.length < 2) {
      return { ok: false, error: 'Please enter your full name (at least 2 characters).' };
    }
    if (!email || !email.includes('@')) {
      return { ok: false, error: 'Please enter a valid email address.' };
    }
    if (!password || password.length < 6) {
      return { ok: false, error: 'Password must be at least 6 characters long.' };
    }
    if (this.db.users.some((u) => u.email === email)) {
      return {
        ok: false,
        error: 'An account with this email already exists. Please log in instead.',
      };
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const newUser: StoredUser = {
      id: `USR-${Date.now().toString(36).toUpperCase()}`,
      name: cleanName,
      email,
      role: 'user',
      salt,
      passwordHash: hashPassword(password, salt),
      createdAt: new Date().toISOString(),
    };
    this.db.users.push(newUser);
    return { ok: true, session: this.issueSession(newUser) };
  }

  public loginWithRole(
    emailRaw: string,
    password: string,
    expectedRole: UserRole
  ): { ok: true; session: { token: string; user: AuthUser } } | { ok: false; error: string } {
    const email = emailRaw.trim().toLowerCase();
    const user = this.db.users.find((u) => u.email === email);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return { ok: false, error: 'Invalid email or password.' };
    }
    if (user.role !== expectedRole) {
      return {
        ok: false,
        error:
          expectedRole === 'admin'
            ? 'This account is a citizen account. Please sign in on the User Login page.'
            : 'This account is an authority officer account. Please use the Admin Login page.',
      };
    }
    return { ok: true, session: this.issueSession(user) };
  }

  public getUserByToken(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const now = Date.now();
    const sess = this.db.sessions.find((s) => s.token === token && s.expiresAt > now);
    if (!sess) return null;
    const user = this.db.users.find((u) => u.id === sess.userId);
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    };
  }

  public logout(token: string | undefined): void {
    if (!token) return;
    const before = this.db.sessions.length;
    this.db.sessions = this.db.sessions.filter((s) => s.token !== token);
    if (this.db.sessions.length !== before) {
      this.save();
    }
  }

  public linkReport(userId: string, issueId: string): void {
    const list = this.db.reportOwnership[userId] ?? [];
    if (!list.includes(issueId)) {
      list.unshift(issueId);
      this.db.reportOwnership[userId] = list.slice(0, 50);
      this.save();
    }
  }

  public getOwnedReportIds(userId: string): string[] {
    return this.db.reportOwnership[userId] ?? [];
  }
}
