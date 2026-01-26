#include <array>
#include <cstddef>

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
