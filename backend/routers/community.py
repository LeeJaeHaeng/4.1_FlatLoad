from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete
from db.database import get_db
from db.models import Post, PostLike, Comment, CertifiedUser
from db.schemas import PostCreate, PostOut, CommentCreate, CommentOut

router = APIRouter(prefix="/api/community", tags=["community"])


def _post_out(row: Post, comment_count: int = 0) -> PostOut:
    return PostOut(
        id=row.id,
        title=row.title,
        content=row.content,
        userId=row.user_id,
        userEmail=row.user_email,
        displayName=row.display_name,
        createdAt=row.created_at.isoformat(),
        likes=row.likes,
        commentCount=comment_count,
        isCertified=bool(row.is_certified),
    )


def _comment_out(row: Comment) -> CommentOut:
    return CommentOut(
        id=row.id,
        postId=row.post_id,
        content=row.content,
        userId=row.user_id,
        userEmail=row.user_email,
        displayName=row.display_name,
        createdAt=row.created_at.isoformat(),
        isCertified=bool(row.is_certified),
    )


async def _check_certified(certified_key: str, db: AsyncSession) -> bool:
    if not certified_key:
        return False
    cert = (await db.execute(
        select(CertifiedUser).where(CertifiedUser.certified_key == certified_key)
    )).scalar_one_or_none()
    return cert is not None


# ── 게시글 ────────────────────────────────────────────────────────

@router.get("/posts", response_model=list[PostOut])
async def get_posts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Post).order_by(Post.created_at.desc())
    )).scalars().all()

    counts = {
        r.post_id: r.cnt
        for r in (await db.execute(
            select(Comment.post_id, func.count(Comment.id).label("cnt"))
            .group_by(Comment.post_id)
        )).all()
    }
    return [_post_out(r, counts.get(r.id, 0)) for r in rows]


@router.post("/posts", response_model=PostOut)
async def create_post(body: PostCreate, db: AsyncSession = Depends(get_db)):
    is_certified = await _check_certified(body.certified_key, db)
    post = Post(
        title=body.title, content=body.content,
        user_id=body.user_id, user_email=body.user_email,
        display_name=body.display_name,
        is_certified=is_certified,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return _post_out(post)


@router.delete("/posts/{post_id}")
async def delete_post(post_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    post = await db.get(Post, post_id)
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    if post.user_id != user_id:
        raise HTTPException(403, "본인 게시글만 삭제할 수 있습니다")
    await db.execute(delete(Comment).where(Comment.post_id == post_id))
    await db.execute(delete(PostLike).where(PostLike.post_id == post_id))
    await db.delete(post)
    await db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/like")
async def toggle_like(post_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    post = await db.get(Post, post_id)
    if not post:
        raise HTTPException(404, "게시글을 찾을 수 없습니다")

    existing = (await db.execute(
        select(PostLike).where(PostLike.post_id == post_id, PostLike.user_id == user_id)
    )).scalar_one_or_none()

    if existing:
        await db.delete(existing)
        await db.execute(update(Post).where(Post.id == post_id)
            .values(likes=func.greatest(0, Post.likes - 1)))
        liked = False
    else:
        db.add(PostLike(post_id=post_id, user_id=user_id))
        await db.execute(update(Post).where(Post.id == post_id)
            .values(likes=Post.likes + 1))
        liked = True

    await db.commit()
    await db.refresh(post)
    return {"likes": post.likes, "liked": liked}


@router.get("/posts/{post_id}/liked/{user_id}")
async def get_liked(post_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    row = (await db.execute(
        select(PostLike).where(PostLike.post_id == post_id, PostLike.user_id == user_id)
    )).scalar_one_or_none()
    return {"liked": bool(row)}


# ── 댓글 ─────────────────────────────────────────────────────────

@router.get("/posts/{post_id}/comments", response_model=list[CommentOut])
async def get_comments(post_id: int, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Comment).where(Comment.post_id == post_id).order_by(Comment.created_at.asc())
    )).scalars().all()
    return [_comment_out(r) for r in rows]


@router.post("/posts/{post_id}/comments", response_model=CommentOut)
async def add_comment(post_id: int, body: CommentCreate, db: AsyncSession = Depends(get_db)):
    if not await db.get(Post, post_id):
        raise HTTPException(404, "게시글을 찾을 수 없습니다")
    is_certified = await _check_certified(body.certified_key, db)
    c = Comment(
        post_id=post_id, content=body.content,
        user_id=body.user_id, user_email=body.user_email,
        display_name=body.display_name,
        is_certified=is_certified,
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    return _comment_out(c)


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: int, user_id: str, db: AsyncSession = Depends(get_db)):
    c = await db.get(Comment, comment_id)
    if not c:
        raise HTTPException(404, "댓글을 찾을 수 없습니다")
    if c.user_id != user_id:
        raise HTTPException(403, "본인 댓글만 삭제할 수 있습니다")
    await db.delete(c)
    await db.commit()
    return {"ok": True}
