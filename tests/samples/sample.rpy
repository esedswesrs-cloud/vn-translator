# Karakter
define e = Character("Eileen")
define l = Character("Lucy")

label start:
    scene bg room
    show eileen happy

    # Ini komentar, harus dilewati
    e "Kamu sudah membuat game baru!"
    "Narasi: ruangan itu sunyi dan gelap."
    e "Katanya \"halo\" sambil tersenyum."

    menu:
        "Pilih jalanmu:"
        "Jalan Eileen":
            jump eileen_path
        "Jalan Lucy":
            jump lucy_path

label eileen_path:
    e "Kamu memilih jalanku."
    return

# Blok terjemahan, harus dilewati
translate indonesian start_abc:
    old "Hello"
    new "Halo"
