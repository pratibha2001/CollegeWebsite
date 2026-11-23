export async function handleStudentGraduated(client, data) {
  const payload = data.Payload ?? data;   // works whether the worker passes the row or the payload
  await client.query(
    `update "Common"."Users" set "UserType" = 'Alumni' where "UserId" = $1`, [payload.userId]);
  await client.query(
    `insert into "Common"."UserRoles" ("UserId","RoleId")
     select $1, "RoleId" from "Common"."Roles" where "RoleCode" = 'ALUMNI'
     on conflict do nothing`, [payload.userId]);
}