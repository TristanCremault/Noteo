-- Script à exécuter dans Supabase : SQL Editor > New query > coller > Run.
--
-- IMPORTANT : ce script remplace la structure précédente par un vrai chiffrement
-- de bout en bout. Si tu avais déjà des comptes de test avec des notes, elles
-- seront perdues par ce changement (normal en phase de test). "drop table"
-- supprime l'ancienne table avant de recréer la nouvelle version chiffrée.
--
-- Avec cette structure, Supabase ne stocke plus jamais tes notes en clair :
-- seul un bloc chiffré (enc_blob) est envoyé, et la clé qui permettrait de le
-- déchiffrer n'existe que sur ton appareil, dérivée de ton mot de passe. Ce
-- script peut être relancé plusieurs fois sans erreur.

drop table if exists user_data;

create table user_data (
  user_id uuid references auth.users(id) on delete cascade primary key,
  enc_salt text not null,
  enc_iv text,
  enc_blob text,
  updated_at timestamptz not null default now()
);

alter table user_data enable row level security;

drop policy if exists "Chacun peut lire ses propres données" on user_data;
create policy "Chacun peut lire ses propres données"
  on user_data for select
  using (auth.uid() = user_id);

drop policy if exists "Chacun peut créer sa propre ligne" on user_data;
create policy "Chacun peut créer sa propre ligne"
  on user_data for insert
  with check (auth.uid() = user_id);

drop policy if exists "Chacun peut modifier ses propres données" on user_data;
create policy "Chacun peut modifier ses propres données"
  on user_data for update
  using (auth.uid() = user_id);

drop policy if exists "Chacun peut supprimer ses propres données" on user_data;
create policy "Chacun peut supprimer ses propres données"
  on user_data for delete
  using (auth.uid() = user_id);
