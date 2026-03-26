import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { CreatePRDSchema } from "@/lib/schemas/prd";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");

    const prds = productId
      ? db.prepare("SELECT * FROM prds WHERE product_id = ? ORDER BY created_at DESC").all(productId)
      : db.prepare("SELECT * FROM prds ORDER BY created_at DESC").all();

    return NextResponse.json(prds);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch PRDs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreatePRDSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { product_id, title, content, status } = parsed.data;
    const result = db
      .prepare(
        "INSERT INTO prds (product_id, title, content, status) VALUES (?, ?, ?, ?)"
      )
      .run(product_id, title, content, status ?? "draft");

    const prd = db.prepare("SELECT * FROM prds WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(prd, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create PRD" }, { status: 500 });
  }
}
