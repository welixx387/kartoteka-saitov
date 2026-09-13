import { put, list, del } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

function normalizeUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v) ? v : 'https://' + v;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function readAllSites() {
  const { blobs } = await list({ prefix: 'sites/' });
  const items = await Promise.all(
    blobs.map(async (b) => {
      try {
        const res = await fetch(b.url, { cache: 'no-store' });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    })
  );
  return items.filter(Boolean).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const items = await readAllSites();
      res.status(200).json(items);
      return;
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const url = normalizeUrl(body.url);
      if (!url) {
        res.status(400).json({ error: 'Ссылка обязательна' });
        return;
      }

      const id = randomUUID();
      const title = (body.title || '').trim() || hostnameOf(url);
      let photoUrl = null;
      let photoPath = null;

      if (body.photoDataUrl && typeof body.photoDataUrl === 'string') {
        const match = /^data:(image\/\w+);base64,(.+)$/.exec(body.photoDataUrl);
        if (match) {
          const contentType = match[1];
          const buffer = Buffer.from(match[2], 'base64');
          const ext = contentType.split('/')[1] || 'jpg';
          photoPath = `photos/${id}.${ext}`;
          const photoBlob = await put(photoPath, buffer, {
            access: 'public',
            addRandomSuffix: false,
            contentType,
          });
          photoUrl = photoBlob.url;
        }
      }

      const entry = { id, url, title, photoUrl, photoPath, createdAt: Date.now() };
      await put(`sites/${id}.json`, JSON.stringify(entry), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
      });

      res.status(201).json(entry);
      return;
    }

    if (req.method === 'DELETE') {
      const id = (req.query && req.query.id) || '';
      if (!id) {
        res.status(400).json({ error: 'id обязателен' });
        return;
      }
      const items = await readAllSites();
      const item = items.find((x) => x.id === id);
      await del(`sites/${id}.json`);
      if (item && item.photoPath) {
        try {
          await del(item.photoPath);
        } catch {
          // orphaned photo blob, not fatal
        }
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : 'Internal error' });
  }
}
