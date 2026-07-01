# Épuration de l'écran Séances — analyse et pistes

Notes de travail suite à l'analyse du code (Muscu.html + server.js) pour épurer
l'écran "Séances" de la fiche athlète (coach) et, plus largement, réduire la
redondance entre Live / Programme / Bibliothèque / Historique dans toute l'app.

À reprendre plus tard pour prioriser et implémenter.

## Utilité de chaque bloc (écran Séances, fiche athlète coach)

- **🔴 Séance Live** — outil utilisé par le coach, en direct à la salle avec
  l'athlète : il ajoute les exercices et séries au fur et à mesure. À la fin,
  ça enregistre une séance classique dans l'historique, marquée
  `createdByCoach: true`.
- **📥 Programme** ("Importer un Excel") — le plan hebdomadaire récurrent
  (Lundi = dos, Mardi = jambes...) importé une fois par le coach
  (`DATA.programs[athleteId]`). C'est lui qui fait apparaître les points
  orange "Prévu" chaque semaine dans le calendrier.
- **📚 "9 séances" (Bibliothèque)** — une liste de séances à la carte
  assignée par le coach (`DATA.sessionLibrary[athleteId]`), sans jour fixe :
  l'athlète pioche dedans quand il veut s'entraîner.

Trois actions légitimement différentes (qui déclenche l'action : coach en
direct / plan récurrent / séances libres) — pas absurdes en soi. Le problème
n'est pas ces 3 blocs eux-mêmes, mais la façon dont ils se répètent ailleurs
dans l'app.

## Constat : pourquoi ça paraît encombré/répétitif

- **5 calendriers codés séparément**, qui affichent en grande partie les
  mêmes données :
  1. `AthleteCalendarSummary` (Muscu.html:6022) — coach, onglet Séances/Nutrition
  2. `HomeScreen` (Muscu.html:3745-3906) — athlète, onglet 🏋️ Séances
  3. `LiveSessionCalendar` (Muscu.html:12528) — réutilisé dans coach/Historique
     ET athlète/⚡ Live
  4. `BibliothequeScreen` (Muscu.html:12354-12392) — athlète, onglet 📚 Biblio
  5. `CoachCalendarView` (Muscu.html:6678) — coach, calendrier global multi-athlètes

- **Les séances "Live" apparaissent 3 fois** : carte Live (fiche athlète),
  mini-calendrier dans l'onglet Historique (coach), onglet ⚡ Live (athlète)
  — trois vitrines pour le même filtre `sessions.filter(s => s.createdByCoach)`.

- **"Programme" ≠ "Programmes"** : le plan Excel gratuit (1 coach → 1 athlète,
  `DATA.programs`) et le catalogue payant "Programmes d'entraînement"
  (Module → Séance, achat Stripe, `DATA.trainingPrograms`) sont deux systèmes
  totalement différents, sans donnée partagée — juste un nom presque
  identique. Source de confusion pour l'utilisateur.

- **Bug fonctionnel trouvé au passage (pas juste du bruit visuel)** : une
  séance "planifiée" depuis Biblio ou Live (`POST /api/planned-sessions`,
  `DATA.plannedSessions`) n'apparaît PAS sur le calendrier principal Séances
  (`AthleteCalendarSummary` / `HomeScreen` ne lisent jamais ce store).

- Autres stores adjacents identifiés en plus de ceux ci-dessus :
  `DATA.scheduleMoves` (déplacement ponctuel d'un jour de programme),
  `DATA.myLibrary` (bibliothèque perso de l'athlète, fusionnée visuellement
  avec la bibliothèque coach dans le même écran `BibliothequeScreen`),
  `DATA.savedPrograms` (archives de programme, athlète sans coach surtout).

## Critères pour épurer (pas une préférence esthétique)

1. **Qui déclenche l'action** (coach vs athlète, temps réel vs planifié) →
   garder distinct seulement si l'usage est vraiment différent.
2. **Est-ce la même donnée sous-jacente affichée deux fois ?** → si oui,
   fusionner l'affichage, pas nécessairement la logique/API.

## Pistes concrètes, par ordre d'impact estimé

1. **Fusionner le calendrier de l'onglet Historique avec celui de Séances**
   (ils montrent déjà les mêmes séances "Fait") — supprime un calendrier
   entier (`LiveSessionCalendar` dans Historique devient inutile).
2. **Regrouper Live / Programme / Bibliothèque en une seule zone compacte**
   sur la fiche athlète : Live en CTA principal, Programme et Bibliothèque en
   lignes secondaires, plutôt que 3 cartes pleine largeur empilées.
3. **Renommer "Programmes" (catalogue payant)** en quelque chose comme
   "Catalogue" pour ne plus le confondre avec "Programme" (plan hebdo).
4. **Corriger le trou fonctionnel** : faire apparaître les séances
   planifiées (`plannedSessions`) sur le calendrier principal Séances.
5. (Piste plus lourde, non chiffrée) Envisager de fusionner `SessionScreen`
   (séance manuelle/live côté athlète, Muscu.html:913) et
   `CoachLiveSessionScreen` (Muscu.html:7310) — logique très proche,
   dupliquée dans deux composants séparés, pourrait devenir un seul
   composant avec une prop `role`.

## Décision

En attente — à reprendre pour choisir par où commencer (recommandation :
commencer par le point 1, le plus gros gain visuel pour le moins de risque).
