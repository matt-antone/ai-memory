drop policy if exists "service_role_all_memory_namespaces" on memory_namespaces;
create policy "service_role_all_memory_namespaces"
on memory_namespaces
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_all_memory_items" on memory_items;
create policy "service_role_all_memory_items"
on memory_items
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_all_memory_embeddings" on memory_embeddings;
create policy "service_role_all_memory_embeddings"
on memory_embeddings
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_all_memory_edges" on memory_edges;
create policy "service_role_all_memory_edges"
on memory_edges
for all
to service_role
using (true)
with check (true);

drop policy if exists "service_role_all_memory_events" on memory_events;
create policy "service_role_all_memory_events"
on memory_events
for all
to service_role
using (true)
with check (true);
