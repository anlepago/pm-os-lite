import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { CreateProductSchema } from "@/lib/schemas/product";

export async function GET() {
  try {
    const products = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
    return NextResponse.json(products);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch products" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = CreateProductSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { name, description, owner } = parsed.data;
    const result = db
      .prepare("INSERT INTO products (name, description, owner) VALUES (?, ?, ?)")
      .run(name, description ?? null, owner ?? null);

    const product = db.prepare("SELECT * FROM products WHERE id = ?").get(result.lastInsertRowid);
    return NextResponse.json(product, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Failed to create product" }, { status: 500 });
  }
}
