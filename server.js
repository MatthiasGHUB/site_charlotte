require('dotenv').config();
const express    = require('express');
const nodemailer = require('nodemailer');
const {
  initDb, getConfig, setConfig,
  getRendezVousByDate, getAllRendezVous,
  createRendezVous, deleteRendezVous
} = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// ─── Mailer ───────────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  const jours = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const mois  = ['janvier','février','mars','avril','mai','juin',
                  'juillet','août','septembre','octobre','novembre','décembre'];
  const date = new Date(`${y}-${m}-${d}T12:00:00`);
  return `${jours[date.getDay()]} ${parseInt(d)} ${mois[parseInt(m)-1]} ${y}`;
}

function generateSlots(dateStr, config, bookedHeures) {
  const date = new Date(`${dateStr}T12:00:00`);
  const dayOfWeek = date.getDay();
  const joursOuverts = config.jours_ouverts.split(',').map(Number);
  if (!joursOuverts.includes(dayOfWeek)) return [];

  const [startH, startM] = config.heure_debut.split(':').map(Number);
  const [endH,   endM]   = config.heure_fin.split(':').map(Number);

  const slots = [];
  let cur = startH * 60 + startM;
  const end = endH * 60 + endM;

  while (cur + 60 <= end) {
    const h    = Math.floor(cur / 60).toString().padStart(2, '0');
    const min  = (cur % 60).toString().padStart(2, '0');
    const time = `${h}:${min}`;
    slots.push({ heure: time, disponible: !bookedHeures.includes(time) });
    cur += 60;
  }
  return slots;
}

function emailHtml({ nom, prenom, date, heure, description }) {
  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#2C2C2C;">
    <div style="background:linear-gradient(135deg,#E8739A,#F0A07A,#F5C842);
                padding:2rem;border-radius:1rem 1rem 0 0;text-align:center;">
      <h1 style="color:#fff;margin:0;font-weight:normal;">Au fil du quotidien</h1>
      <p style="color:rgba(255,255,255,.9);margin:.5rem 0 0;">Ergothérapie – Charlotte Morel</p>
    </div>
    <div style="background:#FFFAF7;padding:2rem;border-radius:0 0 1rem 1rem;
                box-shadow:0 4px 16px rgba(232,115,154,.15);">
      <h2 style="color:#E8739A;font-weight:normal;">Votre rendez-vous est confirmé !</h2>
      <p>Bonjour <strong>${prenom} ${nom}</strong>,</p>
      <p>Votre rendez-vous a bien été enregistré :</p>
      <table style="width:100%;border-collapse:collapse;margin:1.5rem 0;">
        <tr style="background:#fff3f7;">
          <td style="padding:.75rem 1rem;font-weight:bold;">📅 Date</td>
          <td style="padding:.75rem 1rem;">${formatDate(date)}</td>
        </tr>
        <tr>
          <td style="padding:.75rem 1rem;font-weight:bold;">🕐 Heure</td>
          <td style="padding:.75rem 1rem;">${heure}</td>
        </tr>
        ${description ? `
        <tr style="background:#fff3f7;">
          <td style="padding:.75rem 1rem;font-weight:bold;">📝 Motif</td>
          <td style="padding:.75rem 1rem;">${description}</td>
        </tr>` : ''}
      </table>
      <p style="color:#5A5A5A;font-size:.9rem;">
        Pour modifier ou annuler votre rendez-vous, contactez-moi directement.
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:1.5rem 0;" />
      <p style="color:#5A5A5A;font-size:.85rem;text-align:center;">
        Charlotte Morel · Ergothérapeute<br/>
        <a href="mailto:${process.env.GMAIL_USER}" style="color:#E8739A;">${process.env.GMAIL_USER}</a>
      </p>
    </div>
  </div>`;
}

// ─── Middleware admin ──────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
  if (user === 'admin' && pass === process.env.ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Identifiants incorrects' });
}

// ─── Routes publiques ─────────────────────────────────────────────────────────

// Créneaux disponibles pour une date
app.get('/api/disponibilites', (req, res) => {
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date invalide' });
  }
  // Refuser les dates passées
  if (date < new Date().toISOString().slice(0, 10)) {
    return res.json({ slots: [] });
  }
  const config  = getConfig();
  const booked  = getRendezVousByDate(date).map(r => r.heure);
  const slots   = generateSlots(date, config, booked);
  res.json({ slots });
});

// Jours disponibles pour un mois (pour griser le calendrier)
app.get('/api/jours-disponibles', (req, res) => {
  const { annee, mois } = req.query;
  if (!annee || !mois) return res.status(400).json({ error: 'Paramètres manquants' });

  const config = getConfig();
  const joursOuverts = config.jours_ouverts.split(',').map(Number);
  const today = new Date().toISOString().slice(0, 10);

  const nbJours = new Date(annee, mois, 0).getDate();
  const jours = [];

  for (let d = 1; d <= nbJours; d++) {
    const dateStr = `${annee}-${String(mois).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    if (dateStr < today) { jours.push({ date: dateStr, disponible: false }); continue; }

    const date = new Date(`${dateStr}T12:00:00`);
    const ouvert = joursOuverts.includes(date.getDay());
    if (!ouvert) { jours.push({ date: dateStr, disponible: false }); continue; }

    const booked = getRendezVousByDate(dateStr).map(r => r.heure);
    const slots  = generateSlots(dateStr, config, booked);
    jours.push({ date: dateStr, disponible: slots.some(s => s.disponible) });
  }
  res.json({ jours });
});

// Créer un rendez-vous
app.post('/api/rendez-vous', async (req, res) => {
  const { date, heure, nom, prenom, telephone, email, description } = req.body;

  if (!date || !heure || !nom || !prenom || !email) {
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const config = getConfig();
  const booked = getRendezVousByDate(date).map(r => r.heure);
  const slots  = generateSlots(date, config, booked);
  const slot   = slots.find(s => s.heure === heure);

  if (!slot || !slot.disponible) {
    return res.status(409).json({ error: 'Ce créneau n\'est plus disponible' });
  }

  const rdv = createRendezVous({ date, heure, nom, prenom, telephone, email, description });

  try {
    await transporter.sendMail({
      from:    `"Au fil du quotidien" <${process.env.GMAIL_USER}>`,
      to:      email,
      subject: `Confirmation RDV du ${formatDate(date)} à ${heure}`,
      html:    emailHtml({ nom, prenom, date, heure, description })
    });
  } catch (e) {
    console.error('Erreur mail:', e.message);
  }

  res.status(201).json({ success: true, rdv });
});

// ─── Routes admin ─────────────────────────────────────────────────────────────
app.get('/api/admin/rendez-vous',       requireAdmin, (req, res) => res.json(getAllRendezVous()));
app.delete('/api/admin/rendez-vous/:id', requireAdmin, (req, res) => { deleteRendezVous(req.params.id); res.json({ success: true }); });
app.get('/api/admin/config',            requireAdmin, (req, res) => res.json(getConfig()));
app.put('/api/admin/config',            requireAdmin, (req, res) => { setConfig(req.body); res.json({ success: true }); });

// ─── Démarrage ────────────────────────────────────────────────────────────────
initDb();
app.listen(PORT, () => console.log(`✓ Serveur sur http://localhost:${PORT}`));
