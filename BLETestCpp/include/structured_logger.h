#pragma once

#include <array>
#include <cstddef>
#include <cstring>
#include <functional>
#include <type_traits>


inline void print(const char* fmt, ...)
{
    va_list args;
    va_start(args, fmt);
    // Print formatted string
    std::vprintf(fmt, args);
    va_end(args);

    // Append newline and flush
    std::putchar('\n');
    std::fflush(stdout);
}


template <typename T>
class static_vector
{
private:
    T* m_data;
    std::size_t m_capacity;
    std::size_t m_size = 0;

public:
    using value_type = T;
    using iterator = T*;
    using const_iterator = const T*;

    template<std::size_t N>
    explicit static_vector(std::array<T, N>& backing)
        : m_data(backing.data()), m_capacity(N)
    {}

    constexpr std::size_t capacity() const noexcept { return m_capacity; }
    std::size_t size() const noexcept { return m_size; }
    bool empty() const noexcept { return m_size == 0; }
    bool full() const noexcept { return m_size == m_capacity; }
    void clear() noexcept { m_size = 0; }

    iterator begin() noexcept { return m_data; }
    iterator end() noexcept { return m_data + m_size; }
    const_iterator begin() const noexcept { return m_data; }
    const_iterator end() const noexcept { return m_data + m_size; }

    T& operator[](std::size_t i) { return m_data[i]; }
    const T& operator[](std::size_t i) const { return m_data[i]; }

    T* data() noexcept { return m_data; }
    const T* data() const noexcept { return m_data; }

    void push_back(const T& value)
    {
        if (m_size >= m_capacity) return;
        m_data[m_size++] = value;
    }

    template<class Container>
    void append(const Container& c)
    {
        for (auto it = std::begin(c); it != std::end(c); ++it)
        {
            if (m_size >= m_capacity) return;
            m_data[m_size++] = *it;
        }
    }
};


// ------------------------------------------------------------
// Compile-time fmt_code lookup
// ------------------------------------------------------------
template<typename T> struct always_false : std::false_type {};
template <typename T> struct fmt {
   static_assert(always_false<T>::value, "Unsupported type");
};
template <> struct fmt<int8_t>   { enum : uint8_t { code = 'b' }; };
template <> struct fmt<uint8_t>  { enum : uint8_t { code = 'B' }; };
template <> struct fmt<int16_t>  { enum : uint8_t { code = 'h' }; };
template <> struct fmt<uint16_t> { enum : uint8_t { code = 'H' }; };
template <> struct fmt<int32_t>  { enum : uint8_t { code = 'i' }; };
template <> struct fmt<uint32_t> { enum : uint8_t { code = 'I' }; };
template <> struct fmt<int64_t>  { enum : uint8_t { code = 'q' }; };
template <> struct fmt<uint64_t> { enum : uint8_t { code = 'Q' }; };
template <> struct fmt<float>    { enum : uint8_t { code = 'f' }; };
template <> struct fmt<double>   { enum : uint8_t { code = 'd' }; };

// Core helper: append an integer value in big-endian byte order
template<typename IntT, typename Container>
void pack_integer_be(Container& buf, IntT value)
{
    for (uint32_t i = 0; i < sizeof(IntT); ++i) {
        buf.push_back(static_cast<uint8_t>(value >> (8 * (sizeof(IntT) - 1 - i))));
    }
}

// Generic pack<T> for integral types
template<typename Container, typename T>
void pack(Container& buf, T value)
{
    static_assert(std::is_integral<T>::value, "pack<T>: integral types only");
    pack_integer_be(buf, value);
}

// Overload for float
template<typename Container>
void pack(Container& buf, float value)
{
    uint32_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    pack_integer_be(buf, bits);
}

// Overload for double
template<typename Container>
void pack(Container& buf, double value)
{
    uint64_t bits;
    std::memcpy(&bits, &value, sizeof(bits));
    pack_integer_be(buf, bits);
}

// Variable-length integer packing
template<typename Container, typename T>
void pack_var_int(Container& buf, T num)
{
    if ((num >= 0) && (num < 128))
    {
        pack<Container, uint8_t>(buf, static_cast<uint8_t>(num));
        return;
    }
    if (num < 32768)
    {
        pack<Container, uint16_t>(buf, static_cast<uint16_t>(num | 0x8000));
        return;
    }
    printf("WARNING: Number too large to pack (in pack_var_int): %lld\n", (long long)num);
}

template<typename T>
int var_int_size(T num)
{
    return (num < 128) ? 1 : 2;
}

template<typename Container>
void pack_len(Container& buf, int offset)
{
    // -2 bytes for encoded length
    const int payload_len = buf.size() - offset - 2;
    if (payload_len >= 32768)
    {
        printf("WARNING: Number too large to pack (in pack_len): \n", payload_len);
        return;
    }

    // pack most significant byte and set most significant bit
    buf[offset]     = ((uint8_t)(payload_len >> 8)) | 0x80;
    buf[offset + 1] = (uint8_t)(payload_len);
}

uint8_t get_vision_object_type(vex::aivision::object& obj)
{
    // encode obj.type in the top 2 bits of the returned byte
    switch (obj.type)
    {
        case vex::aivision::objectType::colorObject:
            return 0b00000000;

        case vex::aivision::objectType::codeObject:
            return 0b01000000;

        case vex::aivision::objectType::modelObject:
            return 0b10000000;

        case vex::aivision::objectType::tagObject:
            return 0b11000000;

        default:
            return 0xFF;
    }
}

class EntryBase
{
public:
    virtual ~EntryBase() {}
    virtual uint16_t code() const = 0;
    virtual const std::string& name() const = 0;
    virtual int fmt_size() const = 0;
    virtual int data_size() const = 0;
    virtual bool pack(static_vector<uint8_t>& buf) = 0;
    virtual bool pack_name_and_format(static_vector<uint8_t>& buf) = 0;
};

template<class T>
class Entry : public EntryBase
{
private:
    uint16_t m_code;
    std::string m_name;
    std::function<T()> m_getter;
    bool m_small_scale;
    int m_fmt_size;
    int m_data_size;

public:
    Entry(const uint16_t code, const std::string &name, std::function<T()> getter, bool small_scale = false)
        : m_code(code)
        , m_name(name)
        , m_getter(getter)
        , m_fmt_size(var_int_size(code) + 1 + name.size() + 1) // code + fmt + name + null
        , m_data_size(var_int_size(code) + sizeof(T)) // code + data
        , m_small_scale(small_scale)
    {}

    virtual uint16_t code() const override { return m_code; }
    virtual const std::string& name() const override { return m_name; }
    virtual int fmt_size() const override { return m_fmt_size; }
    virtual int data_size() const override { return m_data_size; }

    virtual bool pack(static_vector<uint8_t>& buf) override
    {
        if (m_data_size + buf.size() > buf.capacity())
        {
            return false;
        }
        pack_var_int(buf, m_code);
        ::pack(buf, m_getter());
        return true;
    }

    virtual bool pack_name_and_format(static_vector<uint8_t>& buf) override
    {
        if (m_fmt_size + buf.size() > buf.capacity())
        {
            return false;
        }
        // send code to identify value
        pack_var_int(buf, m_code);
        // send format code
        const uint8_t fmt_code = m_small_scale ? (fmt<T>::code | 0b10000000) : fmt<T>::code;
        buf.push_back(fmt_code);
        // send name (null-terminated)
        buf.append(m_name);
        buf.push_back('\0');
        return true;
    }
};

class StructuredLogger
{
private:
    std::array<uint8_t, 104> m_bufferStorage{};
    static_vector<uint8_t> m_buffer{m_bufferStorage};
    std::array<uint8_t, 35*AIVISION_MAX_OBJECTS> m_aiBufferStorage{};
    static_vector<uint8_t> m_aiBuffer{m_aiBufferStorage};

    std::array<EntryBase *, 50> m_registryStorage{};
    static_vector<EntryBase *> m_registry{m_registryStorage};
    uint16_t m_next_code = 0;
    int m_fmt_size = 0;
    int m_data_size = 0;

    static constexpr int header_len = 5;

    template<typename T>
    void add_impl(const std::string name, std::function<T()> func, bool small_scale = false)
    {
        if (m_registry.full())
        {
            print("add_impl failure: m_registry is full; can't add '%s'", name);
            return;
        }
        EntryBase * const entry = (EntryBase *)(new Entry<T>(m_next_code++, name, func, small_scale));
        m_fmt_size += entry->fmt_size();
        m_data_size += entry->data_size();
        m_registry.push_back(entry);
    }

public:
    StructuredLogger() {}

    template<typename Func>
    void add(const std::string name, Func func, bool small_scale = false)
    {
        add_impl(name, std::function<decltype(func())()>(func), small_scale);
    }

    template<typename Container>
    void prepare_buffer(Container& buf, uint8_t command)
    {
        buf.clear();
        buf.push_back(0xc0); // special header
        buf.push_back(0xde); // special header
        buf.push_back(command);
        buf.push_back(0x00); // placeholder for length
        buf.push_back(0x00); // placeholder for length
    }

    template<typename Container>
    void send_packet(Container& buf)
    {
        pack_len(buf, 3);
        fwrite(buf.data(), 1, buf.size(), stdout);
        fflush(stdout);
    }

    void send_data_format(void)
    {
        prepare_buffer(m_buffer, 0x46); // data_format_command
        for (auto &entry : m_registry)
        {
            if (!entry->pack_name_and_format(m_buffer))
            {
                send_packet(m_buffer);
                prepare_buffer(m_buffer, 0x46);
                entry->pack_name_and_format(m_buffer);
            }
        }
        send_packet(m_buffer);
    }

    void send_structured_data(void)
    {
        prepare_buffer(m_buffer, 0x44); // structured_data_command
        for (auto &entry : m_registry)
        {
            if (!entry->pack(m_buffer))
            {
                send_packet(m_buffer);
                prepare_buffer(m_buffer, 0x44);
                entry->pack(m_buffer);
            }
        }
        send_packet(m_buffer);
    }

    void send_vision_data(vex::safearray<vex::aivision::object, AIVISION_MAX_OBJECTS>& objs)
    {
        const int objs_len = objs.getLength();
        prepare_buffer(m_aiBuffer, 0x49); // vision_data_command
        for (int i = 0; i < objs_len; i++)
        {
            vex::aivision::object& obj = objs[i];
            if (obj.exists)
            {
                pack_vision_object(m_aiBuffer, obj);
            }
        }
        send_packet(m_aiBuffer);
    }

    template<typename Container>
    void pack_vision_object(Container& buf, vex::aivision::object& obj)
    {
        // obj.id; store in bottom 6 bits of first byte
        // classroom objects: 0 - 7
        // VIQRC Mix & Match objects: 0 - 3
        // AprilTag: 0 - 36
        const uint8_t obj_type = get_vision_object_type(obj);
        if (obj_type == 0xFF)
        {
            print("Unsupported objectType %d", obj.type);
            return;
        }
        uint8_t obj_id = obj_type | (obj.id & 0b111111);
        buf.push_back(obj_id);
        pack_var_int(buf, obj.originX);    //  0-320
        pack_var_int(buf, obj.originY);    //  0-240
        pack_var_int(buf, obj.centerX);    //  0-320
        pack_var_int(buf, obj.centerY);    //  0-240
        pack_var_int(buf, obj.width);      //  1-320
        pack_var_int(buf, obj.height);     //  1-240
        pack_var_int(buf, obj.score);      //  1-100
        pack(buf, obj.angle);              //  0-360; float
        if (obj.type == vex::aivision::objectType::tagObject)
        {
            // only pack if it's an AprilTag
            pack_var_int(buf, obj.tag.x[0]);
            pack_var_int(buf, obj.tag.y[0]);
            pack_var_int(buf, obj.tag.x[1]);
            pack_var_int(buf, obj.tag.y[1]);
            pack_var_int(buf, obj.tag.x[2]);
            pack_var_int(buf, obj.tag.y[2]);
            pack_var_int(buf, obj.tag.x[3]);
            pack_var_int(buf, obj.tag.y[3]);
        }
    }
};
